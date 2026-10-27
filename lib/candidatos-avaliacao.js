const fs = require('node:fs');

const normalizarNome = (texto) => String(texto).normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');
const normalizarCpf = (texto) => String(texto).replace(/\D/g, '');
const cpfValido = (cpf) => {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const tamanho of [9, 10]) {
    const soma = [...cpf.slice(0, tamanho)].reduce((total, digito, i) => total + Number(digito) * (tamanho + 1 - i), 0);
    const resto = (soma * 10) % 11;
    if ((resto === 10 ? 0 : resto) !== Number(cpf[tamanho])) return false;
  }
  return true;
};

function lerLinhas(texto) {
  texto = texto.replace(/^\uFEFF/, '');
  const separador = texto.split(/\r?\n/, 1)[0].includes(';') ? ';' : ',';
  const linhas = [];
  let linha = [], campo = '', aspas = false, fechado = false;
  for (let i = 0; i < texto.length; i++) {
    const caractere = texto[i];
    if (aspas) {
      if (caractere === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else { aspas = false; fechado = true; }
      } else campo += caractere;
    } else if (caractere === separador || caractere === '\r' || caractere === '\n') {
      linha.push(campo.trim()); campo = ''; fechado = false;
      if (caractere !== separador) {
        if (linha.some(Boolean)) linhas.push(linha);
        linha = [];
        if (caractere === '\r' && texto[i + 1] === '\n') i++;
      }
    } else if (caractere === '"' && !campo && !fechado) aspas = true;
    else {
      if (fechado && !/\s/.test(caractere)) throw new Error('CSV: conteúdo após fechamento de aspas.');
      campo += caractere;
    }
  }
  if (aspas) throw new Error('CSV: campo com aspas não fechado.');
  linha.push(campo.trim());
  if (linha.some(Boolean)) linhas.push(linha);
  return linhas;
}

function lerNota(valor, linha, coluna) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(valor)) throw new Error(`Linha ${linha}: ${coluna} inválida.`);
  const numero = Number(valor.replace(',', '.'));
  if (!Number.isFinite(numero) || numero < 0 || numero > 100) throw new Error(`Linha ${linha}: ${coluna} fora de 0 a 100.`);
  return numero;
}

function lerCandidatos(arquivo) {
  const linhas = lerLinhas(fs.readFileSync(arquivo, 'utf8'));
  if (linhas.length < 2) throw new Error('CSV sem candidatos.');
  const cabecalho = linhas.shift().map(normalizarNome);
  const obrigatorias = ['NOME', 'CPF', 'NOTA 1', 'NOTA 2'];
  for (const coluna of obrigatorias) {
    if (cabecalho.filter(nome => nome === coluna).length !== 1) throw new Error(`CSV precisa de uma única coluna ${coluna}.`);
  }
  const cpfs = new Set();
  return linhas.map((campos, indice) => {
    const linha = indice + 2;
    if (campos.length !== cabecalho.length) throw new Error(`Linha ${linha}: número de colunas incorreto.`);
    const campo = nome => campos[cabecalho.indexOf(nome)];
    const cpf = normalizarCpf(campo('CPF'));
    const nome = campo('NOME');
    if (!cpfValido(cpf)) throw new Error(`Linha ${linha}: CPF inválido.`);
    if (cpfs.has(cpf)) throw new Error(`Linha ${linha}: CPF repetido.`);
    if (!nome) throw new Error(`Linha ${linha}: nome obrigatório.`);
    cpfs.add(cpf);
    return { nome, cpf, nota1: lerNota(campo('NOTA 1'), linha, 'nota 1'),
      nota2: lerNota(campo('NOTA 2'), linha, 'nota 2'), linha };
  });
}

// A ordem da lista do portal nunca determina de qual linha vêm as notas.
// A identidade deve conter CPF completo e nome conferidos na tela do candidato.
function localizarCandidato(candidatos, identidade) {
  const cpf = normalizarCpf(identidade.cpf ?? '');
  if (!cpfValido(cpf)) throw new Error('Identidade no portal: CPF completo e válido obrigatório.');
  const encontrados = candidatos.filter(candidato => candidato.cpf === cpf);
  if (encontrados.length !== 1) throw new Error('CPF ausente ou duplicado no CSV. Avaliação bloqueada.');
  const candidato = encontrados[0];
  if (!identidade.nome || normalizarNome(candidato.nome) !== normalizarNome(identidade.nome)) {
    throw new Error('Nome do portal não corresponde ao CPF do CSV. Avaliação bloqueada.');
  }
  return Object.freeze({ ...candidato });
}

module.exports = { lerCandidatos, localizarCandidato, normalizarCpf, normalizarNome };
