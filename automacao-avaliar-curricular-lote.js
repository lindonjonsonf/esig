/* Avaliação curricular por identidade: CPF + nome e notas da mesma linha do CSV. */
const path = require('node:path');
const { chromium } = require('playwright');
const { lerCandidatos, localizarCandidato, normalizarNome } = require('./lib/candidatos-avaliacao');

const args = process.argv.slice(2);
const valor = (opcao, padrao = '') => {
  const indice = args.indexOf(opcao);
  if (indice < 0) return padrao;
  if (!args[indice + 1] || args[indice + 1].startsWith('--')) throw new Error(`Informe um valor após ${opcao}.`);
  return args[indice + 1];
};
const csv = path.resolve(valor('--csv', path.join(__dirname, 'lista_lato_candidato.csv')));
const processo = valor('--processo', 'PROCESSO SELETIVO INTERNO LATO SENSU 2026.2 - PSIMUW44H9V');
const curso = valor('--curso', 'PROGRAMA DE RESIDÊNCIA EM VIGILÂNCIA EM SAÚDE- VIGILÂNCIA E QUALIDADE/HU/SUP');
const quesitos = [valor('--quesito-1', 'TEM CARRO?'), valor('--quesito-2', 'TEM MOTO')];
const confirmar = args.includes('--confirmar');
const auditar = args.includes('--auditar-identidades');
const limite = Number(valor('--limite', args.includes('--todos-pendentes') || auditar ? String(Number.MAX_SAFE_INTEGER) : '1'));
const observacao = valor('--observacao', 'Aprovado');
const senha = process.env.SIGAA_PASSWORD;
const senhaConfirmacao = process.env.SIGAA_ANALYSIS_PASSWORD;
const legendaLista = 'Lista de Solicitações de Análise Curricular';
const legendaDados = 'Dados da Inscrição';
const legendaQuesitos = 'Quesitos de Avaliação';

if (args.includes('--help') || args.includes('-h')) {
  console.log('Uso: npm.cmd run avaliar-curricular -- [--csv arquivo.csv] [--processo nome] [--curso nome] [--limite N | --todos-pendentes] [--auditar-identidades | --confirmar] [--validar-csv]');
  console.log('Sem --confirmar, preenche e confere o resumo sem salvar a avaliação. Padrão: 1 candidato.');
  console.log('--auditar-identidades confere CPF e nome de todos os pendentes sem preencher notas.');
  console.log('--validar-csv confere somente o arquivo, sem abrir o navegador.');
  console.log('Nota 1: TEM CARRO?; nota 2: TEM MOTO. Personalize com --quesito-1 e --quesito-2.');
  console.log('Todos os documentos são DEFERIDOS. Observação padrão: Aprovado; use --observacao para alterar.');
  console.log('Login: SIGAA_USERNAME (padrão marcos.lauande) e SIGAA_PASSWORD. Confirmação: SIGAA_ANALYSIS_PASSWORD.');
  process.exit(0);
}

const tabela = (page, legenda) => page.locator('table').filter({ has: page.locator('caption, thead td.subFormulario').filter({ hasText: new RegExp(`^${legenda}$`) }) });
const navegar = async (page, botao) => {
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }), botao.click()]);
  await page.waitForLoadState('networkidle');
};
const dadosInscricao = async page => {
  const dados = tabela(page, legendaDados);
  await dados.waitFor();
  return dados.evaluate(table => Object.fromEntries([...table.querySelectorAll('tr')]
    .filter(row => row.cells.length === 2)
    .map(row => [row.cells[0].innerText.trim(), row.cells[1].innerText.trim()])));
};
const conferirIdentidade = async (page, candidatos, esperado) => {
  const dados = await dadosInscricao(page);
  const candidato = localizarCandidato(candidatos, { cpf: dados['CPF do Candidato:'], nome: dados['Nome do Candidato:'] });
  if (candidato.cpf !== esperado.cpf) throw new Error('A tela abriu outro CPF. Avaliação bloqueada.');
  if (normalizarNome(dados['Processo Seletivo:']) !== normalizarNome(processo)
    || normalizarNome(dados['Curso:']) !== normalizarNome(curso)) throw new Error('Processo ou curso divergente na tela.');
  return candidato;
};
const selecionar = async (page, id, nome, aceitarPeriodo = false) => {
  const select = page.locator(`[id="${id}"]`);
  const opcoes = await select.locator('option').evaluateAll(es => es.map(e => ({ nome: e.textContent.trim(), valor: e.value })));
  const encontradas = opcoes.filter(opcao => normalizarNome(opcao.nome) === normalizarNome(nome)
    || (aceitarPeriodo && new RegExp(`^${normalizarNome(nome).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} - \\d{4}\\.[12]$`).test(normalizarNome(opcao.nome))));
  if (encontradas.length !== 1) throw new Error(`Seleção ausente ou ambígua: ${nome}. Opções: ${opcoes.map(opcao => opcao.nome).join('; ')}`);
  await select.selectOption(encontradas[0].valor);
  await page.waitForLoadState('networkidle');
};

async function abrirLista(page) {
  await page.goto('https://implantacao.intranet.ufma.br/sigaa', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="username"]').fill(process.env.SIGAA_USERNAME || 'marcos.lauande');
  await page.locator('input[name="password"]').fill(senha);
  await navegar(page, page.getByRole('button', { name: /ENTRAR/i }));
  if (/vinculos\.jsf/.test(page.url())) await navegar(page, page.getByRole('link', { name: 'Chefia/Diretoria', exact: true }));
  await navegar(page, page.getByRole('link', { name: 'Processos Seletivos', exact: true }));
  await page.getByRole('link', { name: 'Cadastros', exact: true }).click();
  await navegar(page, page.getByRole('link', { name: 'Análise Curricular', exact: true }));
  await selecionar(page, 'form:processoSeletivo', processo, true);
  await page.waitForFunction(() => document.getElementById('form:curso')?.options.length > 1, undefined, { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  await selecionar(page, 'form:curso', curso);
  await selecionar(page, 'form:situacao', 'PENDENTE DE AVALIAÇÃO');
  await navegar(page, page.getByRole('button', { name: 'Buscar', exact: true }));
  if ((await page.locator('body').innerText()).includes('O usuário não faz parte da banca avaliadora')) {
    throw new Error('Conta não vinculada à banca deste processo e curso.');
  }
  await tabela(page, legendaLista).waitFor();
}

async function preencher(page, candidato) {
  const aguardarAjax = () => page.waitForResponse(response => response.request().method() === 'POST'
    && /\/AnaliseCurricular\//.test(response.url())
    && response.request().postData()?.includes('AJAXREQUEST='));
  const tabelaNotas = tabela(page, legendaQuesitos);
  const linhas = tabelaNotas.locator('tbody tr');
  if (await tabelaNotas.locator('input[name$=":notaQuesito"]').count() !== 2) throw new Error('Quantidade de quesitos diferente de dois.');
  for (const [indice, nome] of quesitos.entries()) {
    const linha = linhas.filter({ has: page.getByText(nome, { exact: true }) });
    if (await linha.count() !== 1) throw new Error(`Quesito ausente ou ambíguo: ${nome}.`);
    const nota = indice === 0 ? candidato.nota1 : candidato.nota2;
    const campo = linha.locator('input[name$=":notaQuesito"]');
    await campo.fill(nota.toFixed(2).replace('.', ','));
    await Promise.all([aguardarAjax(), campo.press('Tab')]);
    await page.waitForLoadState('networkidle');
    if (Number((await campo.inputValue()).replace(',', '.')) !== nota) throw new Error(`Nota não foi aplicada em ${nome}.`);
  }
  const documentos = tabela(page, 'Documentos de Apoio a Análise').locator('select');
  for (const select of await documentos.all()) {
    if (await select.inputValue() !== 'true') {
      await Promise.all([aguardarAjax(), select.selectOption({ label: 'DEFERIDO' })]);
      await page.waitForLoadState('networkidle');
    }
  }
  await page.locator('[id="form:observacoes"]').fill(observacao);
  await navegar(page, page.getByRole('button', { name: 'Avançar >>', exact: true }));
}

async function conferirResumo(page, candidatos, esperado) {
  const candidato = await conferirIdentidade(page, candidatos, esperado);
  await page.locator('[id="form:senha"]').waitFor().catch(async () => {
    const campos = await page.locator('input[name$=":notaQuesito"],select').evaluateAll(es => es.map(e => ({ campo: e.name, valor: e.value })));
    const mensagens = (await page.locator('.erros, .errors, .error, .alert, [role="alert"]').allTextContents()).map(t => t.trim()).filter(Boolean);
    throw new Error(`Resumo não abriu. Campos de avaliação: ${JSON.stringify(campos)}. Mensagens: ${mensagens.join('; ')}`);
  });
  const resumo = await tabela(page, legendaQuesitos).evaluate(table => {
    const cabecalhos = [...table.querySelectorAll('thead th')].map(th => th.innerText.trim());
    const colunaNota = cabecalhos.indexOf('Nota');
    return [...table.querySelectorAll('tbody tr')].map(row => ({ quesito: row.cells[0]?.innerText.trim(), nota: row.cells[colunaNota]?.innerText.trim() }));
  });
  for (const [indice, nome] of quesitos.entries()) {
    const linhas = resumo.filter(linha => normalizarNome(linha.quesito) === normalizarNome(nome));
    const nota = indice === 0 ? candidato.nota1 : candidato.nota2;
    if (linhas.length !== 1 || Number(linhas[0].nota?.replace(',', '.')) !== nota) throw new Error(`Resumo divergente para ${nome}. Confirmação bloqueada.`);
  }
  const situacoes = await tabela(page, 'Documentos de Apoio a Análise').locator('tbody tr').evaluateAll(rows => rows.filter(row => row.cells.length >= 4).map(row => row.cells[row.cells.length - 1].innerText.trim()));
  if (situacoes.some(situacao => situacao !== 'DEFERIDO')) throw new Error('Resumo contém documento não deferido.');
}

async function run() {
  if (!Number.isSafeInteger(limite) || limite < 1) throw new Error('--limite deve ser um inteiro positivo.');
  if (auditar && confirmar) throw new Error('--auditar-identidades não pode ser usado com --confirmar.');
  const candidatos = lerCandidatos(csv);
  console.log(`CSV validado: ${candidatos.length} candidatos, com duas notas por CPF.`);
  if (args.includes('--validar-csv')) return;
  if (!senha) throw new Error('Defina SIGAA_PASSWORD para acessar o SIGAA.');
  if (confirmar && !senhaConfirmacao) throw new Error('Defina SIGAA_ANALYSIS_PASSWORD para confirmar avaliações.');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  try {
    await abrirLista(page);
    const inventario = await tabela(page, legendaLista).locator('tbody tr').evaluateAll(rows => rows.map(row => ({ nome: row.cells[0]?.innerText.split('\n')[0].trim(), status: row.cells[2]?.innerText.trim() })));
    const pendentes = inventario.filter(row => row.status === 'PENDENTE DE AVALIAÇÃO');
    const planos = [];
    for (const row of pendentes) {
      const encontrados = candidatos.filter(c => normalizarNome(c.nome) === normalizarNome(row.nome));
      if (encontrados.length !== 1 || pendentes.filter(r => normalizarNome(r.nome) === normalizarNome(row.nome)).length !== 1) {
        throw new Error('Nome ausente ou ambíguo entre portal e CSV. Nenhuma avaliação será preenchida.');
      }
      planos.push(encontrados[0]);
    }
    console.log(`Pendentes encontrados: ${planos.length}. Modo: ${auditar ? 'auditoria de identidade' : confirmar ? 'confirmação' : 'teste até o resumo'}.`);
    // Auditoria prévia de todo o lote selecionado antes do primeiro preenchimento.
    for (const candidato of planos.slice(0, limite)) {
      const linha = tabela(page, legendaLista).locator('tbody tr').filter({ has: page.getByText(candidato.nome, { exact: true }) });
      if (await linha.count() !== 1) throw new Error('Linha do candidato ambígua no portal.');
      await navegar(page, linha.locator('a[title="Analisar Currículo"]'));
      await conferirIdentidade(page, candidatos, candidato);
      console.log(`Identidade conferida: linha CSV ${candidato.linha}.`);
      await navegar(page, page.getByRole('button', { name: '<< Voltar', exact: true }));
    }
    if (auditar) { console.log('Auditoria concluída sem preencher ou confirmar avaliações.'); return; }
    for (const candidato of planos.slice(0, limite)) {
      const linha = tabela(page, legendaLista).locator('tbody tr').filter({ has: page.getByText(candidato.nome, { exact: true }) });
      await navegar(page, linha.locator('a[title="Analisar Currículo"]'));
      await conferirIdentidade(page, candidatos, candidato);
      await preencher(page, candidato);
      await conferirResumo(page, candidatos, candidato);
      console.log(`Resumo conferido: linha CSV ${candidato.linha}; notas ${candidato.nota1.toFixed(2)} e ${candidato.nota2.toFixed(2)}.`);
      if (confirmar) {
        await page.locator('[id="form:senha"]').fill(senhaConfirmacao);
        await navegar(page, page.getByRole('button', { name: 'Confirmar', exact: true }));
        await tabela(page, legendaLista).waitFor();
        await selecionar(page, 'form:situacao', '-- TODOS --');
        await navegar(page, page.getByRole('button', { name: 'Buscar', exact: true }));
        const linhaFinal = tabela(page, legendaLista).locator('tbody tr').filter({ has: page.getByText(candidato.nome, { exact: true }) });
        if (await linhaFinal.count() !== 1 || await linhaFinal.evaluate(row => row.cells[2]?.innerText.trim()) !== 'AVALIADO') throw new Error('Status AVALIADO não confirmado. Lote interrompido.');
        console.log(`Avaliação confirmada: linha CSV ${candidato.linha}.`);
      } else {
        await navegar(page, page.getByRole('button', { name: '<< Voltar', exact: true }));
        await navegar(page, page.getByRole('button', { name: '<< Voltar', exact: true }));
      }
    }
    console.log(confirmar ? 'Lote concluído.' : 'Testes concluídos sem confirmar avaliações.');
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
