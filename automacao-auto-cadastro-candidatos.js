/*
 * Cadastra candidatos no auto-cadastro público do SIGPS.
 * Lê CPFs autorizados de um arquivo e grava cada cadastro confirmado.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const confirmRegistration = args.includes('--confirmar-cadastro');
const help = args.includes('--help') || args.includes('-h');
const inputIndex = args.indexOf('--cpfs');
const limitIndex = args.indexOf('--limite');
const screensIndex = args.indexOf('--telas');
// Arquivos, limite do lote e quantidade de páginas podem ser definidos na linha de comando.
const cpfFile = path.resolve(inputIndex >= 0 ? args[inputIndex + 1] || '' : 'cpfs-candidatos.txt');
const candidateLimit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
const screenCount = screensIndex >= 0 ? Number(args[screensIndex + 1]) : 1;
const completedFile = path.resolve('cpfs-cadastrados.txt');
// Altere URL/senha somente para uma instância e conta de teste autorizadas.
const registrationUrl = 'https://implantacao.intranet.ufma.br/sigps/public/auto-cadastro/cadastrar';
// Dados repetidos em cada candidato; opções vazias usam a primeira opção válida do portal.
const candidateDefaults = {
  birthDate: '2000-09-11',
  namePrefix: '[interno] - candidato ',
  emailPrefix: 'candidato',
  emailDomain: 'gmail.com',
  password: 'Teste123',
  selectOptions: {
    sex: '',
    ethnicity: '',
    naturalityState: '',
    naturalityMunicipality: '',
  },
};

if (help) {
  console.log('Uso: node automacao-auto-cadastro-candidatos.js [--cpfs arquivo.txt] [--limite quantidade] [--telas 1-3] --confirmar-cadastro');
  console.log('Informe CPFs autorizados separados por vírgula ou por linha em cpfs-candidatos.txt.');
  process.exit(0);
}

if (!confirmRegistration) {
  console.error('Para enviar cadastros, informe explicitamente --confirmar-cadastro.');
  process.exit(1);
}

if (inputIndex >= 0 && !args[inputIndex + 1]) {
  console.error('Informe o caminho do arquivo após --cpfs.');
  process.exit(1);
}

if (limitIndex >= 0 && (!Number.isInteger(candidateLimit) || candidateLimit < 1)) {
  console.error('Informe um número inteiro positivo após --limite.');
  process.exit(1);
}

if (screensIndex >= 0 && (!Number.isInteger(screenCount) || screenCount < 1 || screenCount > 3)) {
  console.error('Informe um número inteiro entre 1 e 3 após --telas.');
  process.exit(1);
}

const normalizeCpf = (value) => value.replace(/\D/g, '');

const isValidCpf = (value) => {
  const cpf = normalizeCpf(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

  const digitAt = (length) => {
    const sum = cpf
      .slice(0, length)
      .split('')
      .reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return digitAt(9) === Number(cpf[9]) && digitAt(10) === Number(cpf[10]);
};

const readCpfFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo de CPFs não encontrado: ${filePath}`);
  }

  const entries = fs.readFileSync(filePath, 'utf8')
    .split(/[\r\n,]+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (entries.length === 0) throw new Error('O arquivo de CPFs está vazio.');

  const seen = new Set();
  return entries.map((entry, index) => {
    const cpf = normalizeCpf(entry);
    if (!isValidCpf(cpf)) throw new Error(`CPF inválido na posição ${index + 1} da lista.`);
    if (seen.has(cpf)) throw new Error(`CPF repetido na posição ${index + 1} da lista.`);
    seen.add(cpf);
    return cpf;
  });
};

const readCompletedCpfs = () => {
  if (!fs.existsSync(completedFile)) return new Set();
  return new Set(
    fs.readFileSync(completedFile, 'utf8')
      .split(/\r?\n/)
      .map(normalizeCpf)
      .filter((cpf) => isValidCpf(cpf))
  );
};

const maskCpf = (cpf) => `***.***.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
const isExistingCandidateMessage = (text) => {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  return /cpf.{0,120}(ja cadastrad|ja possui cadastro|ja tem cadastro)|usuario\s+ja cadastrado|ja existe um cadastro na ufma associado ao e-mail/.test(normalized);
};

const findField = async (page, labelPattern, role = 'textbox') => {
  const field = page.getByLabel(new RegExp(labelPattern, 'i')).first();
  if (await field.count()) return field;

  const alternative = page.getByRole(role, { name: new RegExp(labelPattern, 'i') }).first();
  if (await alternative.count()) return alternative;

  throw new Error(`Campo não encontrado no formulário: ${labelPattern}`);
};

const fillField = async (page, pattern, value) => {
  const field = await findField(page, pattern);
  await field.fill(value);
};

const selectFirstOption = async (page, pattern, preferredText = '') => {
  const field = await findField(page, pattern, 'combobox');
  const selectHandle = await field.elementHandle();
  await page.waitForFunction((select) => [...select.options].some((option) =>
    !option.disabled && option.value && !/^(selecione|selecione\.\.\.)/i.test(option.textContent.trim())
  ), selectHandle, { timeout: 15000 });
  const options = await field.locator('option').evaluateAll((items) => items
    .filter((option) => !option.disabled && option.value && !/^(selecione|selecione\.\.\.)/i.test(option.textContent.trim()))
    .map((option) => ({ value: option.value, text: option.textContent.trim() })));

  if (!options.length) throw new Error(`Nenhuma opção disponível para: ${pattern}`);
  const normalize = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const option = preferredText
    ? options.find((item) => normalize(item.text).includes(normalize(preferredText)))
    : options[0];
  if (!option) throw new Error(`Opção "${preferredText}" não encontrada em ${pattern}.`);
  await field.selectOption(option.value);
};

const run = async () => {
  const cpfs = readCpfFile(cpfFile);
  const candidates = cpfs.slice(0, candidateLimit).map((cpf, index) => ({ cpf, number: index + 1 }));
  const completed = readCompletedCpfs();
  const pending = candidates.filter((candidate) => {
    if (!completed.has(candidate.cpf)) return true;
    console.log(`Candidato ${candidate.number}: CPF ${maskCpf(candidate.cpf)} já consta como cadastrado; ignorando.`);
    return false;
  });

  if (!pending.length) {
    console.log('Todos os candidatos selecionados já constam como cadastrados.');
    return;
  }

  const workerCount = Math.min(screenCount, pending.length);
  const browser = await chromium.launch({ headless: false });
  let nextCandidate = 0;
  let registeredCount = 0;

  try {
    const workers = Array.from({ length: workerCount }, async (_, workerIndex) => {
      const page = await browser.newPage();
      let activeCpf = '';
      let currentStage = 'iniciar tela';
      page.on('dialog', async (dialog) => {
        const message = dialog.message().replace(activeCpf, '[CPF oculto]');
        console.error(`Diálogo do portal (${dialog.type()}): ${message}`);
        await dialog.dismiss();
      });
      console.log(`Tela ${workerIndex + 1}/${workerCount} iniciada.`);

      try {
        while (nextCandidate < pending.length) {
          const candidate = pending[nextCandidate++];
          const { cpf, number } = candidate;
          activeCpf = cpf;
          currentStage = 'abrir auto-cadastro';

          console.log(`Preparando candidato ${number}/${candidates.length} (${maskCpf(cpf)}).`);
          await page.goto(registrationUrl, { waitUntil: 'networkidle', timeout: 30000 });
          currentStage = 'preencher CPF';
          const cpfInput = page.locator('#cpf');
          await cpfInput.click();
          await cpfInput.pressSequentially(cpf, { delay: 25 });
          await page.waitForFunction(() => document.querySelector('#verificar')?.disabled === false, undefined, { timeout: 10000 });
          currentStage = 'verificar CPF';
          await page.getByRole('button', { name: /^Verificar$/i }).click();

          currentStage = 'aguardar resposta da verificação';
          await page.waitForFunction(() => {
            const text = document.body?.innerText || '';
            const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
            const cpfAlreadyRegistered = /cpf.{0,120}(ja cadastrad|ja possui cadastro|ja tem cadastro)|usuario\s+ja cadastrado|ja existe um cadastro na ufma associado ao e-mail/.test(normalized);
            const nameFieldReady = [...document.querySelectorAll('label')].some((label) => /nome/i.test(label.innerText));
            return cpfAlreadyRegistered || nameFieldReady;
          }, undefined, { timeout: 30000 });

          const verificationText = await page.locator('body').innerText();
          if (isExistingCandidateMessage(verificationText)) {
            fs.appendFileSync(completedFile, `${cpf}\n`, 'utf8');
            completed.add(cpf);
            registeredCount += 1;
            console.log(`O portal já tinha o candidato ${number}; CPF sincronizado em ${completedFile}.`);
            continue;
          }

          currentStage = 'aguardar formulário de cadastro';
          await page.getByLabel(/nome/i).first().waitFor({ state: 'visible', timeout: 30000 });

          currentStage = 'preencher dados do candidato';
          const dateField = await findField(page, 'data de nascimento');
          const dateType = await dateField.evaluate((element) => element.type);
          const [year, month, day] = candidateDefaults.birthDate.split('-');
          await fillField(page, 'nome', `${candidateDefaults.namePrefix}${number}`);
          await dateField.fill(dateType === 'date' ? candidateDefaults.birthDate : `${day}/${month}/${year}`);

          await selectFirstOption(page, 'sexo', candidateDefaults.selectOptions.sex);
          await selectFirstOption(page, 'raça|etnia', candidateDefaults.selectOptions.ethnicity);
          await selectFirstOption(page, 'UF naturalidade', candidateDefaults.selectOptions.naturalityState);
          await selectFirstOption(page, 'município naturalidade', candidateDefaults.selectOptions.naturalityMunicipality);

          await fillField(page, 'e-mail|email', `${candidateDefaults.emailPrefix}${number}@${candidateDefaults.emailDomain}`);
          await fillField(page, 'senha', candidateDefaults.password);
          await fillField(page, 'confirmar senha|confirme a senha', candidateDefaults.password);

          const submit = page.getByRole('button', { name: /cadastrar|concluir|finalizar|confirmar/i }).last();
          if (!(await submit.count())) {
            const actions = await page.locator('button, input[type="submit"], input[type="button"]').evaluateAll((elements) => elements.map((element) => ({
              tag: element.tagName,
              type: element.type,
              text: (element.innerText || element.value || '').trim(),
              disabled: element.disabled,
            })));
            throw new Error(`Botão de conclusão do cadastro não encontrado. Ações disponíveis: ${JSON.stringify(actions)}`);
          }
          currentStage = 'enviar cadastro';
          await submit.click();

          currentStage = 'aguardar confirmação do portal';
          await page.waitForFunction(() => {
            const text = (document.body?.innerText || '').toLocaleLowerCase();
            const success = /cadastro.{0,40}(realizado|efetuado|conclu[ií]do)|usu[aá]rio.{0,40}cadastrad|conta.{0,40}criada/.test(text);
            const leftForm = !location.pathname.includes('/auto-cadastro/cadastrar');
            return success || leftForm;
          }, { timeout: 30000 });

          const bodyText = (await page.locator('body').innerText()).toLocaleLowerCase();
          if (/erro|n[aã]o foi poss[ií]vel|inv[aá]lid[oa]|j[aá] cadastrad[oa]/.test(bodyText)) {
            throw new Error(`O portal indicou falha no cadastro do candidato ${number}.`);
          }

          fs.appendFileSync(completedFile, `${cpf}\n`, 'utf8');
          completed.add(cpf);
          registeredCount += 1;
          console.log(`Cadastro confirmado para o candidato ${number}; CPF salvo em ${completedFile}.`);
        }
      } catch (error) {
        const candidate = pending[Math.max(0, nextCandidate - 1)];
        console.error(`Falha na tela ${workerIndex + 1}, etapa "${currentStage}", candidato ${candidate?.number ?? 'desconhecido'} (${maskCpf(activeCpf)}): ${error.stack || error.message}`);
        throw error;
      } finally {
        await page.close();
      }
    });

    const results = await Promise.allSettled(workers);
    const failures = results.filter((result) => result.status === 'rejected');
    console.log(`Processamento encerrado: ${registeredCount} cadastro(s) confirmado(s), ${failures.length} tela(s) com erro.`);
    if (failures.length) {
      throw new AggregateError(failures.map((failure) => failure.reason), 'Uma ou mais telas falharam.');
    }
  } finally {
    await browser.close();
  }
};

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});