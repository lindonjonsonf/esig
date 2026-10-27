/* Inscreve candidatos Lato Sensu do CSV, respeitando o curso e a categoria de cada CPF. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const argValue = (name, fallback = '') => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Informe um valor após ${name}.`);
  return args[index + 1];
};
const processName = argValue('--processo', 'PROCESSO SELETIVO INTERNO LATO SENSU 2026.2 - PSIMUW44H9V');
const csvFile = path.resolve(argValue('--csv', path.join(__dirname, 'lista_lato_candidatos.csv')));
const fallbackCourse = argValue('--curso', 'PROGRAMA DE RESIDÊNCIA EM VIGILÂNCIA EM SAÚDE- VIGILÂNCIA E QUALIDADE');
const completedFile = path.resolve(__dirname, 'inscricoes-lato-confirmadas.jsonl');
const loginUrl = 'https://implantacao.intranet.ufma.br/sigps';
const password = 'Teste123';
const documentPdfPath = path.resolve(argValue('--documento-pdf', path.join(__dirname, 'docs_testes', 'pdf_teste.pdf')));
const validateDocumentsOnly = args.includes('--somente-validar-documentos');
const csvOnly = args.includes('--validar-csv');
const candidateLimit = Number(argValue('--limite', String(Number.MAX_SAFE_INTEGER)));
const screenCount = Number(argValue('--telas', '1'));
const enemYear = '2025';
const distributeCourses = false;
const distributeCategories = false;
const excludedCourseNames = [];
const testData = {
  nomeMae: 'teste da silva', nacionalidade: 'brasileiro', rg: '0003', orgaoExpedicao: 'teste',
  dataExpedicao: '2025-12-20', cep: '59010-000', celular: '84987195155', numero: '100', cidadeEndereco: 'NATAL',
};
if (args.includes('--help') || args.includes('-h')) {
  console.log('Uso: node automacao-processo-seletivo-interno.js [--csv arquivo.csv] [--curso "CURSO"] [--limite N] [--telas 1-4] [--processo "PROCESSO"] [--documento-pdf arquivo.pdf] [--somente-validar-documentos] [--validar-csv]');
  console.log('Padrão: percorre todo o CSV, com uma tela, e confirma as inscrições.');
  console.log('CSV: cpf;curso;categoria (nome e notas são opcionais e não são usados na inscrição).');
  console.log('--curso fornece o curso para linhas sem coluna curso. A categoria sempre vem do CSV.');
  console.log('--validar-csv verifica os dados sem abrir o navegador.');
  console.log('--somente-validar-documentos percorre até o resumo, sem confirmar nem gravar checkpoint.');
  process.exit(0);
}

// CSV com campos entre aspas, delimitadores escapados e quebras de linha.
const parseCsv = (text) => {
  text = text.replace(/^\uFEFF/, '');
  const delimiter = text.split(/\r?\n/, 1)[0].includes(';') ? ';' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (!quoted && field.length) throw new Error('Aspas inválidas no CSV.');
      else quoted = !quoted;
    } else if (!quoted && (char === delimiter || char === '\n' || char === '\r')) {
      row.push(field.trim()); field = '';
      if (char !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else field += char;
  }
  if (quoted) throw new Error('Campo com aspas não fechado no CSV.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};
const readCandidates = () => {
  const rows = parseCsv(fs.readFileSync(csvFile, 'utf8'));
  if (rows.length < 2) throw new Error('CSV vazio ou sem candidatos.');
  const headers = rows.shift().map(normalizeCourseName);
  const cpfIndex = headers.indexOf('cpf'), categoryIndex = headers.indexOf('categoria'), courseIndex = headers.indexOf('curso');
  if (cpfIndex < 0 || categoryIndex < 0) throw new Error('CSV precisa das colunas cpf e categoria.');
  const seen = new Set();
  return rows.map((row, index) => {
    if (row.length !== headers.length) throw new Error(`Linha ${index + 2}: quantidade de colunas incorreta.`);
    const cpf = normalizeCpf(row[cpfIndex]);
    const categoryName = row[categoryIndex];
    const courseName = (courseIndex >= 0 ? row[courseIndex] : '') || fallbackCourse;
    if (!isValidCpf(cpf)) throw new Error(`Linha ${index + 2}: CPF inválido.`);
    if (seen.has(cpf)) throw new Error(`Linha ${index + 2}: CPF repetido.`);
    if (!categoryName) throw new Error(`Linha ${index + 2}: categoria obrigatória.`);
    if (!courseName && !csvOnly) throw new Error(`Linha ${index + 2}: curso ausente. Inclua a coluna curso ou informe --curso.`);
    seen.add(cpf);
    return { cpf, courseName, categoryName, csvLine: index + 2 };
  });
};
const readCompleted = () => {
  if (!fs.existsSync(completedFile)) return new Map();
  const records = fs.readFileSync(completedFile, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  return new Map(records.filter((record) => record.processName === processName).map((record) => [record.cpf, record]));
};
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

const fillPersonalData = async (page, candidateIndex, { courseName, categoryName }) => {
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
  let selectedCourseName = distributeCourses
    ? availableCourses[candidateIndex % availableCourses.length]
    : courseName;
  const courseMatches = availableCourses.filter((label) => normalizeCourseName(label) === normalizeCourseName(selectedCourseName));
  if (courseMatches.length !== 1) {
    throw new Error(`Curso ausente ou ambíguo: ${selectedCourseName}. Opções: ${availableCourses.join('; ')}`);
  }
  selectedCourseName = courseMatches[0];
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
  } else {
    const exact = categories.filter((label) => normalizeCourseName(label) === normalizeCourseName(categoryName));
    const code = categoryName.split(' - ')[0].trim();
    const matches = exact.length ? exact : categories.filter((label) => label.split(' - ')[0].trim() === code);
    if (matches.length !== 1) throw new Error(`Categoria ausente ou ambígua: ${code}. Inscrição não enviada.`);
    selectedCategory = matches[0];
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
  if (!Number.isInteger(candidateLimit) || candidateLimit < 1) throw new Error('--limite precisa ser um inteiro positivo.');
  if (!Number.isInteger(screenCount) || screenCount < 1 || screenCount > 4) throw new Error('--telas precisa ser de 1 a 4.');
  const candidates = readCandidates();
  console.log(`CSV validado: ${candidates.length} candidatos, ${new Set(candidates.map(c => c.categoryName)).size} categorias.`);
  if (csvOnly) {
    console.log(`Linhas sem curso: ${candidates.filter(c => !c.courseName).length}.`);
    return;
  }
  if (!fs.existsSync(documentPdfPath)) throw new Error(`PDF não encontrado: ${documentPdfPath}`);
  const completed = readCompleted();
  const pending = candidates.filter((candidate) => {
    const record = completed.get(candidate.cpf);
    if (!record) return true;
    if (normalizeCourseName(record.courseName) !== normalizeCourseName(candidate.courseName)
      || record.categoryCode !== candidate.categoryName.split(' - ')[0].trim()) {
      throw new Error(`Linha ${candidate.csvLine}: inscrição confirmada com curso/categoria diferente. Confira o checkpoint.`);
    }
    return false;
  }).slice(0, candidateLimit);
  console.log(`Processo: ${processName}. Pendentes selecionados: ${pending.length}.`);
  if (!pending.length) return;
  const browser = await chromium.launch({ headless: false });
  let nextIndex = 0, successCount = 0, failureCount = 0;
  const worker = async () => {
    while (nextIndex < pending.length) {
      const index = nextIndex++;
      const candidate = pending[index];
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        console.log(`Linha ${candidate.csvLine}: ${maskCpf(candidate.cpf)}; curso ${candidate.courseName}; categoria ${candidate.categoryName.split(' - ')[0]}.`);
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.locator('#username').fill(candidate.cpf);
        await page.locator('#password').fill(password);
        await page.getByRole('button', { name: /entrar/i }).first().click();
        await page.waitForURL((url) => url.pathname === '/sigps/', { timeout: 30000 });
        const row = page.locator('tr').filter({ has: page.getByText(processName, { exact: true }) });
        if (await row.count() !== 1) throw new Error('Processo ausente ou ambíguo no portal.');
        await row.locator('a[title="Selecionar Processo Seletivo"]').click();
        await page.waitForURL(/\/sigps\/processo-seletivo\/view\/\d+$/, { timeout: 30000 });
        const subscribe = page.locator('a[title="Inscreva-se"]');
        if (!(await subscribe.count())) throw new Error('Inscrição indisponível ou candidato já inscrito. Confira a inscrição existente.');
        await subscribe.click();
        await page.waitForURL(/\/inscricao-candidato-interno\/iniciar-inscricao\//, { timeout: 30000 });
        const result = await fillPersonalData(page, index, candidate);
        if (result.preview) {
          console.log(`Linha ${candidate.csvLine}: resumo validado, sem confirmação.`);
          continue;
        }
        if (!result.confirmed) throw new Error('Inscrição não confirmada.');
        fs.appendFileSync(completedFile, JSON.stringify({ cpf: candidate.cpf, processName,
          courseName: result.selectedCourseName, categoryCode: result.selectedCategory.split(' - ')[0].trim(),
          confirmedAt: new Date().toISOString() }) + '\n', 'utf8');
        successCount++;
      } catch (error) {
        failureCount++;
        console.error(`Linha ${candidate.csvLine} (${maskCpf(candidate.cpf)}): ${error.message}`);
      } finally {
        await context.close();
      }
    }
  };
  try {
    const results = await Promise.allSettled(Array.from({ length: Math.min(screenCount, pending.length) }, worker));
    for (const result of results) if (result.status === 'rejected') { failureCount++; console.error(result.reason.message); }
  } finally { await browser.close(); }
  console.log(`Encerrado: ${successCount} inscrições confirmadas; ${failureCount} falhas.`);
  if (failureCount) process.exitCode = 1;
};
run().catch((error) => { console.error(error.message); process.exitCode = 1; });
