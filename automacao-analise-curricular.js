/*
 * Abre a Análise Curricular e filtra solicitações por processo seletivo e curso.
 * Apenas consulta a lista; não avalia inscrições nem altera análises.
 */
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const argValue = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1] || '';
};
const help = args.includes('--help') || args.includes('-h');
const processName = argValue('--processo', '[LJ] - PROCESSO SELETIVO INTERNO LATO SENSU 2026.2 - ESTRATEGIA 1 - 2026.1');
const courseName = argValue('--curso');

if (help) {
  console.log('Uso: node automacao-analise-curricular.js --curso "NOME OU TRECHO DO CURSO" [--processo "NOME OU TRECHO DO PROCESSO"]');
  console.log(`Processo padrão: ${processName}`);
  console.log('Abre a lista filtrada e não altera análises curriculares.');
  process.exit(0);
}

if (!processName || !courseName) {
  console.error('Informe --curso e, se necessário, --processo.');
  process.exit(1);
}

const normalizeText = (value = '') => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLocaleLowerCase();

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Use apenas credenciais autorizadas no ambiente de homologação.
  const USER = process.env.SIGAA_USERNAME || 'marcos.lauande';
  const PASS = process.env.SIGAA_PASSWORD;
  if (!PASS) throw new Error('Defina SIGAA_PASSWORD para acessar o SIGAA.');
  const baseUrl = 'https://implantacao.intranet.ufma.br';

  try {
    await page.goto(`${baseUrl}/sigaa`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.locator('input[name="username"]').fill(USER);
    await page.locator('input[name="password"]').fill(PASS);
    await page.getByRole('button', { name: /ENTRAR/i }).click();
    await page.waitForURL(/sigaa\/vinculos\.jsf|sigaa\/verMenuPrincipal\.do/, { timeout: 30000 });

    if (/\/vinculos\.jsf$/.test(page.url())) {
      await page.locator('a[href*="escolhaVinculo.do?dispatch=escolher&vinculo=6"]').first().click();
      await page.waitForURL(/sigaa\/verMenuPrincipal\.do/, { timeout: 30000 });
    }

    await page.getByRole('link', { name: 'Processos Seletivos', exact: true }).click();
    await page.getByRole('link', { name: 'Cadastros', exact: true }).click();
    await page.getByRole('link', { name: 'Análise Curricular', exact: true }).click();
    await page.getByRole('heading', { name: /Análise Curricular/i }).waitFor({ state: 'visible', timeout: 20000 });

    const processSelect = page.locator('#form\\:processoSeletivo');
    const processOptions = await processSelect.locator('option').evaluateAll((options) => options
      .filter((option) => option.value)
      .map((option) => ({ label: option.textContent.trim(), value: option.value })));
    const normalizedProcessName = normalizeText(processName);
    const selectedProcess = processOptions.find((option) => normalizeText(option.label).includes(normalizedProcessName));
    if (!selectedProcess) {
      throw new Error(`Processo não encontrado. Opções disponíveis: ${processOptions.map((option) => option.label).join('; ')}`);
    }

    await processSelect.selectOption(selectedProcess.value);
    const courseSelect = page.locator('#form\\:curso');
    await page.waitForFunction(() => document.querySelector('#form\\:curso')?.options.length > 1, undefined, { timeout: 20000 });
    const courseOptions = await courseSelect.locator('option').evaluateAll((options) => options
      .filter((option) => option.value)
      .map((option) => ({ label: option.textContent.trim(), value: option.value })));
    const normalizedCourseName = normalizeText(courseName);
    const selectedCourse = courseOptions.find((option) => normalizeText(option.label).includes(normalizedCourseName));
    if (!selectedCourse) {
      throw new Error(`Curso não encontrado para este processo. Opções disponíveis: ${courseOptions.map((option) => option.label).join('; ')}`);
    }

    await courseSelect.selectOption(selectedCourse.value);
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await page.locator('table caption').filter({ hasText: 'Lista de Solicitações de Análise Curricular' })
      .waitFor({ state: 'visible', timeout: 30000 });

    const resultCount = await page.locator('table').evaluateAll((tables) => {
      const resultTable = tables.find((table) => table.caption?.innerText.includes('Lista de Solicitações de Análise Curricular'));
      return resultTable?.querySelectorAll('tbody tr').length ?? 0;
    });
    console.log(`Processo: ${selectedProcess.label}`);
    console.log(`Curso: ${selectedCourse.label}`);
    console.log(`Solicitações encontradas: ${resultCount}`);
    console.log('A página foi mantida aberta para consulta; nenhuma análise foi alterada.');
    await page.waitForTimeout(600000);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
