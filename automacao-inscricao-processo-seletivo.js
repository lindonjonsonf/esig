/*
 * Inscreve candidatos no SIGPS, percorre o processo/curso/categoria configurados,
 * confirma a inscrição e registra o sucesso após conferi-lo em Meus Processos Seletivos.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1] || '';
};
const cpfFile = path.resolve(argValue('--cpfs', 'cpfs-cadastrados.txt'));
const limitValue = argValue('--limite', '1');
const candidateLimit = Number(limitValue);
const screenCount = Number(argValue('--telas', '3'));
// Processo e curso padrão; use --processo/--curso para trocar sem editar o script.
const defaultProcessName = '[LJ] - PROCESSO SELETIVO INTERNO GRADUAÇÃO 2026.2 - ESTRATEGIA 1';
const defaultCourseName = 'CIÊNCIAS HUMANAS - CODÓ - Noturno';
const processName = argValue('--processo', defaultProcessName);
const requestedCourseName = argValue('--curso', '');
const courseName = requestedCourseName || defaultCourseName;
const distributeCourses = args.includes('--distribuir-cursos');
// EXCLUSÃO TEMPORÁRIA: remova este item quando o curso puder voltar à distribuição.
const excludedCourseNames = [
  'CIÊNCIAS HUMANAS - CODÓ - Presencial - N - LICENCIATURA PLENA - 2010',
];
// Escolha --categoria para uma cota fixa ou --distribuir-categorias para rodízio.
const categoryName = argValue('--categoria', '');
const distributeCategories = args.includes('--distribuir-categorias');
const completedFile = path.resolve('cpfs-inscritos-processo-seletivo.txt');
const loginUrl = 'https://implantacao.intranet.ufma.br/sigps';
// Parâmetros de teste aplicados a cada candidato; atualize aqui conforme o cenário.
const password = 'Teste123';
const enemYear = argValue('--ano-enem', '2025');
const documentPdf = argValue('--documento-pdf', '');
const documentPdfPath = documentPdf ? path.resolve(documentPdf) : '';
const validateDocumentsOnly = args.includes('--somente-validar-documentos');
const testData = {
  nomeMae: 'teste da silva',
  nacionalidade: 'brasileiro',
  rg: '0003',
  orgaoExpedicao: 'teste',
  dataExpedicao: '2025-12-20',
  cep: '59010-000',
  celular: '84987195155',
  numero: '100',
  cidadeEndereco: 'NATAL',
};

if (help) {
  console.log('Uso: node automacao-inscricao-processo-seletivo.js [--cpfs arquivo.txt] [--limite quantidade] [--telas 1-4] [--processo nome] [--curso nome | --distribuir-cursos] [--categoria nome | --distribuir-categorias] [--ano-enem ano] [--documento-pdf arquivo.pdf] [--somente-validar-documentos]');
  console.log(`Processo padrão: ${defaultProcessName}`);
  console.log(`Curso padrão: ${defaultCourseName}`);
  console.log('Use --distribuir-categorias para alternar categorias pela ordem retornada pelo portal.');
  console.log('Use --distribuir-cursos para alternar cursos pela ordem retornada pelo portal.');
  console.log('O padrão processa um candidato; use --limite para ampliar o lote.');
  process.exit(0);
}

if (!fs.existsSync(cpfFile)) {
  console.error(`Arquivo de CPFs não encontrado: ${cpfFile}`);
  process.exit(1);
}
if (!Number.isInteger(candidateLimit) || candidateLimit < 1) {
  console.error('Informe um número inteiro positivo após --limite.');
  process.exit(1);
}
if (!Number.isInteger(screenCount) || screenCount < 1 || screenCount > 4) {
  console.error('Informe um número entre 1 e 4 após --telas.');
  process.exit(1);
}
if (!processName || !courseName || !/^[0-9]{4}$/.test(enemYear)) {
  console.error('Informe valores válidos para --processo, --curso e --ano-enem.');
  process.exit(1);
}
if (documentPdfPath && !fs.existsSync(documentPdfPath)) {
  console.error(`Arquivo PDF para upload não encontrado: ${documentPdfPath}`);
  process.exit(1);
}
if (distributeCategories && categoryName) {
  console.error('Use --categoria ou --distribuir-categorias, não os dois juntos.');
  process.exit(1);
}
if (distributeCourses && requestedCourseName) {
  console.error('Use --curso ou --distribuir-cursos, não os dois juntos.');
  process.exit(1);
}

const normalizeCpf = (value) => value.replace(/\D/g, '');

const isValidCpf = (value) => {
  const cpf = normalizeCpf(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

  const digitAt = (length) => {
    const sum = cpf.slice(0, length)
      .split('')
      .reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digitAt(9) === Number(cpf[9]) && digitAt(10) === Number(cpf[10]);
};

const readCpfs = () => {
  const entries = fs.readFileSync(cpfFile, 'utf8')
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith('#'));
  const seen = new Set();
  return entries.map((entry, index) => {
    const cpf = normalizeCpf(entry);
    if (!isValidCpf(cpf)) throw new Error(`CPF inválido na posição ${index + 1}.`);
    if (seen.has(cpf)) throw new Error(`CPF repetido na posição ${index + 1}.`);
    seen.add(cpf);
    return cpf;
  });
};

const readCompletedForProcess = () => {
  if (!fs.existsSync(completedFile)) return new Set();
  return new Set(fs.readFileSync(completedFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter((parts) => parts[1] === processName)
    .map((parts) => parts[0]));
};

const maskCpf = (cpf) => `***.***.${cpf.slice(6, 9)}-${cpf.slice(9)}`;

const selectFirstOption = async (page, selector) => {
  const values = await page.locator(`${selector} option`).evaluateAll((options) => options
    .filter((option) => !option.disabled && option.value && !/^selecione$/i.test(option.textContent.trim()))
    .map((option) => option.value));
  if (!values.length) throw new Error(`Nenhuma opção disponível em ${selector}.`);
  await page.locator(selector).selectOption(values[0]);
};

const normalizeCourseName = (value) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLocaleLowerCase();

const fillPersonalData = async (page, candidateIndex) => {
  const enemYearField = page.locator('#anoEnem');
  if (await enemYearField.count()) {
    await enemYearField.selectOption(enemYear);
    await page.getByRole('button', { name: /avançar/i }).click();
    await page.waitForURL(/\/inscricao-candidato-interno\/dados-pessoais\//, { timeout: 30000 });
  } else if (!(await page.locator('#nomeMae').count())) {
    const currentControls = await page.locator('h1, h2, h3, input, select, textarea, button[type="submit"]')
      .evaluateAll((elements) => elements.map((element) => ({
        tag: element.tagName,
        id: element.id,
        name: element.name,
        type: element.type,
        label: element.labels?.[0]?.innerText?.trim() || '',
        text: /^H[1-3]$/.test(element.tagName) ? element.innerText.trim() : undefined,
      })));
    throw new Error(`Etapa inicial não reconhecida. URL: ${page.url()}. Controles: ${JSON.stringify(currentControls)}`);
  }

  await page.locator('#nomeMae').fill(testData.nomeMae);
  await page.locator('#nacionalidade').fill(testData.nacionalidade);
  await page.locator('#rg').fill(testData.rg);
  await selectFirstOption(page, '#ufNaturalidade');
  await page.waitForFunction(() => document.querySelector('#municipioNascimento')?.options.length > 1, undefined, { timeout: 15000 });
  await selectFirstOption(page, '#ufIdentidade');
  await page.locator('#orgaoExpedicao').fill(testData.orgaoExpedicao);
  await page.locator('#dataExpedicao').fill(testData.dataExpedicao);

  const cep = page.locator('#cep');
  await cep.click();
  await cep.fill('');
  await cep.pressSequentially(testData.cep.replace(/\D/g, ''), { delay: 25 });
  await cep.press('Tab');
  await page.waitForFunction(() => Boolean(
    document.querySelector('#logradouro')?.value && document.querySelector('#ufContato')?.value
  ), undefined, { timeout: 15000 });

  await selectFirstOption(page, '#tipoLogradouro');
  await page.locator('#ufContato').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#municipioContato')?.options.length > 1, undefined, { timeout: 15000 });
  await page.locator('#telCelular').fill(testData.celular);
  await page.locator('#numeroEndereco').fill(testData.numero);
  await page.locator('#sexoMasculino').evaluate((radio) => radio.click());
  await selectFirstOption(page, '#municipioNascimento');
  const addressCityOption = page.locator('#municipioContato option').filter({ hasText: /^NATAL$/i }).first();
  await addressCityOption.waitFor({ state: 'attached', timeout: 15000 });
  const addressCityValue = await addressCityOption.getAttribute('value');
  if (!addressCityValue) throw new Error('A opção NATAL não possui valor interno; envio cancelado.');
  await page.locator('#municipioContato').selectOption(addressCityValue);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  if (await page.locator('#municipioContato').inputValue() !== addressCityValue) {
    await page.locator('#municipioContato').selectOption(addressCityValue);
    await page.locator('#municipioContato').dispatchEvent('change');
  }

  const cities = await page.locator('#municipioNascimento, #municipioContato')
    .evaluateAll((selects) => selects.map((select) => ({
      id: select.id,
      name: select.name,
      value: select.value,
      selected: select.options[select.selectedIndex]?.textContent.trim(),
    })));
  const emptyCity = cities.find((city) => !city.value);
  if (emptyCity) throw new Error(`Município não selecionado: ${emptyCity.id}; envio cancelado.`);
  const locationFields = await page.locator('#ufNaturalidade,#municipioNascimento,#ufContato,#municipioContato')
    .evaluateAll((controls) => controls.map((control) => ({
      name: control.name,
      value: control.value,
      formValue: control.form ? new FormData(control.form).get(control.name) : null,
      disabled: control.disabled,
      selected: control.options[control.selectedIndex]?.textContent.trim(),
    })));
  console.log(`UF/municípios antes do envio: ${JSON.stringify(locationFields)}`);

  const [response] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
    page.getByRole('button', { name: /avançar/i }).click(),
  ]);
  if (response && response.status() >= 400) {
    throw new Error(`O portal respondeu HTTP ${response.status()} ao avançar dos dados pessoais.`);
  }
  if (!/\/inscricao-candidato-interno\/oferta-curso\//.test(page.url())) {
    throw new Error(`O portal não avançou para a oferta de curso: ${page.url()}`);
  }

  const pageText = (await page.locator('body').innerText()).toLocaleLowerCase();
  const headings = await page.locator('h1, h2, h3').allTextContents();
  if (/erro no servidor|ocorreu um erro durante/.test(pageText)) {
    throw new Error('O portal retornou erro interno ao avançar dos dados pessoais.');
  }
  if (headings.some((heading) => /dados pessoais/i.test(heading))) {
    const messages = await page.locator('.alert, [role="alert"], .text-danger, .invalid-feedback, .help-block')
      .allTextContents();
    throw new Error(`Os dados pessoais não avançaram: ${messages.join('; ') || 'validação não identificada'}.`);
  }

  const course = page.getByLabel(/curso/i).first();
  const portalCourses = (await course.locator('option').evaluateAll((options) => options
    .filter((option) => !option.disabled && option.value && !/^selecione$/i.test(option.textContent.trim()))
    .map((option) => option.textContent.trim())));
  const excludedCourseKeys = new Set(excludedCourseNames.map(normalizeCourseName));
  const availableCourses = portalCourses.filter((name) => !excludedCourseKeys.has(normalizeCourseName(name)));
  if (!availableCourses.length) throw new Error('Nenhum curso disponível para o processo.');
  if (excludedCourseKeys.has(normalizeCourseName(courseName)) && !distributeCourses) {
    throw new Error(`O curso está temporariamente excluído: ${courseName}`);
  }
  const selectedCourseName = distributeCourses
    ? availableCourses[candidateIndex % availableCourses.length]
    : courseName;
  if (!availableCourses.includes(selectedCourseName)) {
    throw new Error(`Curso não disponível: ${selectedCourseName}. Opções: ${availableCourses.join('; ')}`);
  }
  await course.selectOption({ label: selectedCourseName });
  const category = page.getByLabel(/categoria/i).first();
  const categoryHandle = await category.elementHandle();
  await page.waitForFunction((select) => select.options.length > 1, categoryHandle, { timeout: 15000 });
  const categories = (await category.locator('option').allTextContents())
    .map((option) => option.trim())
    .filter((option) => option && !/^selecione$/i.test(option));
  const categoryCodes = categories.map((option) => option.split(' - ')[0]);
  console.log(`Candidato ${candidateIndex + 1}: curso ${selectedCourseName}. Categorias disponíveis: ${categories.join('; ')}`);

  let selectedCategory = categoryName;
  if (distributeCategories) {
    selectedCategory = categories[candidateIndex % categories.length];
  } else if (!categoryName) {
    return { categories, needsCategory: categories.length > 1 };
  } else if (!categories.includes(categoryName)) {
    throw new Error(`Categoria não encontrada: ${categoryName}. Opções: ${categories.map((option) => option.split(' - ')[0]).join(', ')}`);
  }

  await category.selectOption({ label: selectedCategory });
  console.log(`Candidato ${candidateIndex + 1}: categoria ${selectedCategory.split(' - ')[0]}.`);

  const [courseResponse] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
    page.getByRole('button', { name: /avançar/i }).click(),
  ]);
  if (courseResponse && courseResponse.status() >= 400) {
    throw new Error(`O portal respondeu HTTP ${courseResponse.status()} após selecionar curso e categoria.`);
  }

  const nextText = (await page.locator('body').innerText()).toLocaleLowerCase();
  if (/erro no servidor|ocorreu um erro durante/.test(nextText)) {
    throw new Error('O portal retornou erro interno ao avançar após curso/categoria.');
  }
  const nextHeadings = await page.locator('h1, h2, h3').allTextContents();
  const nextActions = await page.locator('button[type="submit"], input[type="submit"]').evaluateAll((items) =>
    items.map((item) => (item.innerText || item.value || '').trim()).filter(Boolean)
  );
  const nextFields = await page.locator('input, select, textarea').evaluateAll((items) => items.map((item) => ({
    tag: item.tagName,
    id: item.id,
    name: item.name,
    type: item.type,
    label: item.labels?.[0]?.innerText?.trim() || '',
    selected: item.tagName === 'SELECT' ? item.options[item.selectedIndex]?.textContent.trim() : undefined,
    options: item.tagName === 'SELECT' ? [...item.options].map((option) => option.textContent.trim()) : undefined,
  })));
  console.log(`Próxima etapa: ${nextHeadings.join(' / ')}. Ações: ${nextActions.join(', ') || 'nenhuma'}. Campos: ${JSON.stringify(nextFields)}`);

  if (await page.locator('#usoNomeSocial').count()) {
    const [socialResponse] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
      page.getByRole('button', { name: /avançar/i }).click(),
    ]);
    if (socialResponse && socialResponse.status() >= 400) {
      throw new Error(`O portal respondeu HTTP ${socialResponse.status()} na etapa de nome social.`);
    }
    const socialText = (await page.locator('body').innerText()).toLocaleLowerCase();
    if (/erro no servidor|ocorreu um erro durante/.test(socialText)) {
      throw new Error('O portal retornou erro interno ao pular a solicitação de nome social.');
    }
    const afterSocial = await page.locator('h1, h2, h3').allTextContents();
    const afterSocialActions = await page.locator('button[type="submit"], input[type="submit"]').evaluateAll((items) =>
      items.map((item) => (item.innerText || item.value || '').trim()).filter(Boolean)
    );
    const confirmationText = (await page.locator('body').innerText()).slice(0, 1200).replace(/\s+/g, ' ').trim();
    console.log(`Após nome social: ${afterSocial.join(' / ')}. Ações: ${afterSocialActions.join(', ') || 'nenhuma'}. Resumo: ${confirmationText}`);
  }

  if (documentPdfPath) {
    const documentInputs = page.locator('input[type="file"]');
    await documentInputs.first().waitFor({ state: 'attached', timeout: 15000 })
      .catch(() => { throw new Error('A etapa de documentos abriu sem campos para upload. Inscrição não enviada.'); });
    const documentCount = await documentInputs.count();
    for (let index = 0; index < documentCount; index += 1) {
      await documentInputs.nth(index).setInputFiles(documentPdfPath);
    }

    const uploadedCount = await documentInputs.evaluateAll((inputs) =>
      inputs.filter((input) => input.files?.length === 1 && input.files[0].size > 0).length
    );
    if (uploadedCount !== documentCount) {
      throw new Error(`Upload incompleto: ${uploadedCount}/${documentCount} documento(s) receberam o PDF. Inscrição não enviada.`);
    }
    console.log(`PDF de teste anexado a ${uploadedCount} campo(s) de documento.`);

    const continueButton = page.getByRole('button', { name: /avançar|continuar|prosseguir/i }).last();
    if (!(await continueButton.count())) {
      throw new Error('Botão para avançar após o upload dos documentos não encontrado. Inscrição não enviada.');
    }
    const [documentsResponse] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
      continueButton.click(),
    ]);
    if (documentsResponse && documentsResponse.status() >= 400) {
      throw new Error(`O portal respondeu HTTP ${documentsResponse.status()} após o upload dos documentos.`);
    }
    const documentsText = (await page.locator('body').innerText()).toLocaleLowerCase();
    if (/erro no servidor|ocorreu um erro durante/.test(documentsText)) {
      throw new Error('O portal retornou erro após o upload dos documentos.');
    }
  }

  const finalSummary = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
  const normalizedSummary = finalSummary.toLocaleUpperCase();
  if (!/CONFIRMAÇÃO/.test(normalizedSummary) || !normalizedSummary.includes(processName.toLocaleUpperCase())
    || !normalizedSummary.includes(selectedCourseName.toLocaleUpperCase())
    || !normalizedSummary.includes(selectedCategory.split(' - ')[0].toLocaleUpperCase())) {
    throw new Error('O resumo final não corresponde ao processo, curso e categoria selecionados. Inscrição não enviada.');
  }

  if (validateDocumentsOnly) {
    console.log('Validação de documentos concluída; confirmação final da inscrição não executada.');
    return { categories, selectedCategory, selectedCourseName, confirmed: false, preview: true };
  }

  const confirmButton = page.getByRole('button', { name: /confirmar inscrição/i });
  await confirmButton.waitFor({ state: 'visible', timeout: 15000 });
  const [confirmationResponse] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
    confirmButton.click(),
  ]);
  if (confirmationResponse && confirmationResponse.status() >= 400) {
    throw new Error(`O portal respondeu HTTP ${confirmationResponse.status()} ao confirmar a inscrição.`);
  }

  const resultText = (await page.locator('body').innerText()).toLocaleLowerCase();
  if (/erro no servidor|ocorreu um erro durante|não foi possível concluir/.test(resultText)) {
    throw new Error('O portal retornou erro ao confirmar a inscrição.');
  }

  await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 30000 });
  const dashboardText = await page.locator('body').innerText();
  const myProcessesStart = dashboardText.toLocaleUpperCase().indexOf('MEUS PROCESSOS SELETIVOS');
  const openProcessesStart = dashboardText.toLocaleUpperCase().indexOf('PROCESSOS SELETIVOS ABERTOS', myProcessesStart);
  const myProcessesText = myProcessesStart >= 0
    ? dashboardText.slice(myProcessesStart, openProcessesStart >= 0 ? openProcessesStart : undefined)
    : '';
  if (!myProcessesText.includes(processName)) {
    throw new Error('A inscrição não apareceu em Meus Processos Seletivos após a confirmação.');
  }

  return { categories, selectedCategory, selectedCourseName, confirmed: true };
};

const run = async () => {
  const cpfs = readCpfs().slice(0, candidateLimit);
  if (!cpfs.length) throw new Error('O arquivo de CPFs está vazio.');
  const completed = readCompletedForProcess();
  const pending = cpfs.map((cpf, originalIndex) => ({ cpf, originalIndex }))
    .filter(({ cpf, originalIndex }) => {
      if (!completed.has(cpf)) return true;
      console.log(`Candidato ${originalIndex + 1}: inscrição já registrada; ignorando.`);
      return false;
    });
  if (!pending.length) {
    console.log('Todos os candidatos selecionados já estão registrados como inscritos.');
    return;
  }

  const candidatesToProcess = distributeCourses || distributeCategories || categoryName ? pending.length : 1;
  const workerCount = Math.min(screenCount, candidatesToProcess);
  const browser = await chromium.launch({ headless: false });
  let nextIndex = 0;
  let completedCount = 0;
  let failureCount = 0;
  let stopRequested = false;

  const worker = async (workerNumber) => {
    console.log(`Tela ${workerNumber}/${workerCount} iniciada.`);

    while (!stopRequested) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= candidatesToProcess) break;

      const { cpf, originalIndex } = pending[index];
      const page = await browser.newPage();
      console.log(`Tela ${workerNumber}: candidato ${originalIndex + 1}/${cpfs.length} (${maskCpf(cpf)}).`);

      try {
        await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.locator('#username').fill(cpf);
        await page.locator('#password').fill(password);
        await page.getByRole('button', { name: /entrar/i }).first().click();
        await page.waitForURL((url) => url.pathname === '/sigps/', { timeout: 30000 });

        const row = page.locator('tr').filter({ has: page.getByText(processName, { exact: true }) });
        await row.waitFor({ state: 'visible', timeout: 30000 });
        await row.locator('a[title="Selecionar Processo Seletivo"]').click();
        await page.waitForURL(/\/sigps\/processo-seletivo\/view\/\d+$/, { timeout: 30000 });
        await page.locator('a[title="Inscreva-se"]').click();
        await page.waitForURL(/\/inscricao-candidato-interno\/iniciar-inscricao\//, { timeout: 30000 });

        const result = await fillPersonalData(page, originalIndex);
        if (result.needsCategory) {
          console.log(`Defina --categoria ou --distribuir-categorias: ${result.categories.map((option) => option.split(' - ')[0]).join(', ')}`);
          stopRequested = true;
          continue;
        }
        if (result.preview) {
          stopRequested = true;
          console.log(`Tela ${workerNumber}: documentos validados; inscrição não confirmada e CPF não registrado no checkpoint.`);
          continue;
        }
        if (!result.confirmed) throw new Error('O portal não confirmou a inscrição.');

        const categoryCode = result.selectedCategory.split(' - ')[0];
        fs.appendFileSync(completedFile, `${cpf}\t${processName}\t${result.selectedCourseName}\t${categoryCode}\n`, 'utf8');
        completed.add(cpf);
        completedCount += 1;
        console.log(`Tela ${workerNumber}: candidato ${originalIndex + 1} inscrito e verificado; categoria ${categoryCode}.`);

      } catch (error) {
        failureCount += 1;
        console.error(`Tela ${workerNumber}: falha no candidato ${originalIndex + 1} (${maskCpf(cpf)}): ${error.message}`);
        if (/HTTP 5\d\d|erro interno do servidor/i.test(error.message)) {
          stopRequested = true;
          console.error('Fila interrompida após erro interno do servidor.');
        }
      } finally {
        await page.close();
      }
    }
  };

  try {
    const workers = Array.from({ length: workerCount }, (_, index) => worker(index + 1));
    const results = await Promise.allSettled(workers);
    failureCount += results.filter((result) => result.status === 'rejected').length;
  } finally {
    await browser.close();
  }

  console.log(`Processamento encerrado: ${completedCount} inscrição(ões) confirmada(s), ${failureCount} falha(s).`);
  if (failureCount) process.exitCode = 1;
};

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
