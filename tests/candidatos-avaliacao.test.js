const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lerCandidatos, localizarCandidato } = require('../lib/candidatos-avaliacao');
const reais = lerCandidatos(path.join(__dirname, '..', 'lista_lato_candidato.csv'));

function comCsv(texto, verificar) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sigaa-notas-'));
  const arquivo = path.join(pasta, 'dados.csv');
  try { fs.writeFileSync(arquivo, texto); verificar(arquivo); }
  finally { fs.rmSync(pasta, { recursive: true, force: true }); }
}

test('preserva notas decimais, zero e campos entre aspas', () => {
  comCsv(`\uFEFFnome;cpf;nota 1;nota 2\r\n"Candidato; Teste";${reais[0].cpf};0;9,90\r\n`, arquivo => {
    const [candidato] = lerCandidatos(arquivo);
    assert.equal(candidato.nome, 'Candidato; Teste');
    assert.equal(candidato.nota1, 0);
    assert.equal(candidato.nota2, 9.9);
  });
});

test('rejeita CPF repetido em vez de atribuir notas a uma linha arbitrária', () => {
  comCsv(`nome;cpf;nota 1;nota 2\nTeste;${reais[0].cpf};1;2\nOutro;${reais[0].cpf};3;4`,
    arquivo => assert.throws(() => lerCandidatos(arquivo), /CPF repetido/));
});

test('rejeita notas ausentes, não numéricas, negativas ou fora da faixa', () => {
  for (const nota of ['', 'NaN', '-1', '101', '4,555', '4x']) {
    comCsv(`nome;cpf;nota 1;nota 2\nTeste;${reais[0].cpf};${nota};2`,
      arquivo => assert.throws(() => lerCandidatos(arquivo), /nota 1/));
  }
});

test('rejeita colunas obrigatórias duplicadas e CSV malformado', () => {
  comCsv('nome;cpf;nota 1;nota 1;nota 2\nTeste;000;1;1;2',
    arquivo => assert.throws(() => lerCandidatos(arquivo), /única coluna NOTA 1/));
  comCsv('nome;cpf;nota 1;nota 2\n"campo sem fechamento',
    arquivo => assert.throws(() => lerCandidatos(arquivo), /aspas não fechado/));
});

test('associa as duas notas dos 72 candidatos por CPF e nome com lista invertida', () => {
  const invertidos = [...reais].reverse();
  for (const esperado of reais) {
    const encontrado = localizarCandidato(invertidos, { cpf: esperado.cpf, nome: esperado.nome });
    assert.equal(encontrado.cpf, esperado.cpf);
    assert.equal(encontrado.nota1, esperado.nota1);
    assert.equal(encontrado.nota2, esperado.nota2);
    assert.equal(encontrado.linha, esperado.linha);
  }
});

test('bloqueia o CPF de um candidato combinado ao nome de outro', () => {
  assert.notEqual(reais[0].nome, reais[1].nome);
  assert.throws(() => localizarCandidato(reais, { cpf: reais[0].cpf, nome: reais[1].nome }), /Nome do portal/);
});

test('nomes iguais não confundem as notas: CPF continua sendo a chave', () => {
  const homonimos = [
    { ...reais[0], nome: 'Homônimo de teste', nota1: 1.25, nota2: 2.5 },
    { ...reais[1], nome: 'Homônimo de teste', nota1: 8.75, nota2: 9.5 },
  ];
  const encontrado = localizarCandidato(homonimos.reverse(), { cpf: reais[1].cpf, nome: 'Homônimo de teste' });
  assert.equal(encontrado.nota1, 8.75);
  assert.equal(encontrado.nota2, 9.5);
});

test('não aceita CPF mascarado, ausente, duplicado ou nome parcial', () => {
  assert.throws(() => localizarCandidato(reais, { cpf: '***.***.000-00', nome: reais[0].nome }), /CPF completo/);
  assert.throws(() => localizarCandidato([], reais[0]), /CPF ausente/);
  assert.throws(() => localizarCandidato([reais[0], reais[0]], reais[0]), /duplicado/);
  assert.throws(() => localizarCandidato(reais, { cpf: reais[0].cpf, nome: reais[0].nome.slice(0, 8) }), /Nome do portal/);
});

test('duas colunas distintas de notas mantêm sua posição e o CPF com zero inicial', () => {
  const cpfSintetico = '01234567890';
  comCsv(`nome;cpf;nota 1;nota 2\nTeste;${cpfSintetico};3,50;9,90`, arquivo => {
    const candidatos = lerCandidatos(arquivo);
    const encontrado = localizarCandidato(candidatos, { cpf: cpfSintetico, nome: 'Teste' });
    assert.equal(encontrado.cpf, cpfSintetico);
    assert.equal(encontrado.nota1, 3.5);
    assert.equal(encontrado.nota2, 9.9);
  });
});
