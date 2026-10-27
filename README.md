# Automacoes SIGAA/SIGPS 2026

Automacoes Playwright usadas no ambiente de implantacao para preparar processos, criar candidatos, inscreve-los e montar dados de teste para importacao de notas ENEM.

> Use somente no ambiente de homologacao com dados de teste autorizados. Os arquivos de CPF sao dados sensiveis; nao os envie para repositorios ou canais publicos.

## Requisitos

- Windows e PowerShell.
- Node.js 20 ou superior.
- Dependencias instaladas na raiz do projeto.
- Acesso autorizado ao ambiente `implantacao.intranet.ufma.br`.

Instalacao inicial:

```powershell
npm.cmd install
npx.cmd playwright install chromium
```

No PowerShell, use `npm.cmd` para executar os comandos npm deste projeto.

## Passo a passo: onde adicionar os CPFs

Execute os comandos na raiz do projeto, na mesma pasta do `package.json`. Os arquivos com CPFs não vêm do GitHub porque estão no `.gitignore`: crie suas listas localmente. Salve TXT e CSV em UTF-8 e mantenha o CPF como texto, com os 11 dígitos, inclusive zeros à esquerda. Não use notação científica no Excel.

| Etapa | Arquivo na raiz | Como preencher |
| --- | --- | --- |
| Cadastrar candidatos | `cpfs-candidatos.txt` | Você adiciona um CPF por linha, sem cabeçalho. |
| Inscrever candidatos cadastrados | `cpfs-cadastrados.txt` | Gerado pelo cadastro; é a entrada padrão de `selecionar-processo`. |
| Inscrever Lato com categoria por candidato | `lista_lato_candidatos.csv` | Você informa `cpf;curso;categoria`; o curso pode ser omitido se informado em `--curso`. |
| Avaliar candidatos inscritos | `lista_lato_candidato.csv` | Você informa `nome;cpf;nota 1;nota 2`, com nome igual ao cadastro no portal. |
| Alterar notas já avaliadas | `atualizacao_notas_lato.csv` | Você informa `nome;cpf;nota 1;nota 2` com as novas notas. |

**Atenção aos nomes:** a inscrição Lato usa `lista_lato_candidatos.csv` (plural); a avaliação usa `lista_lato_candidato.csv` (singular). São entradas diferentes e não são geradas automaticamente entre etapas. Os CPFs devem corresponder aos mesmos candidatos ao longo do fluxo.

### 1. Colocar os CPFs na lista de cadastro

Crie ou abra o arquivo:

```powershell
notepad.exe cpfs-candidatos.txt
```

Cole um CPF autorizado por linha, sem nome, título ou cabeçalho. Também são aceitos CPFs separados por vírgula e com pontos/traço. O script rejeita CPFs inválidos ou repetidos. Não cole os CPFs nos arquivos JavaScript.

Se sua lista já está em `100_cpfs_validos.txt`, use `--cpfs 100_cpfs_validos.txt` em vez de copiar para outro arquivo. Esse nome não é a entrada padrão.

### 2. Cadastrar primeiro um candidato e depois o lote

```powershell
npm.cmd run cadastrar-candidatos -- --cpfs cpfs-candidatos.txt --limite 1 --telas 1 --confirmar-cadastro
```

Confira o resultado no portal e em `cpfs-cadastrados.txt`. Depois execute o restante, ajustando o limite:

```powershell
npm.cmd run cadastrar-candidatos -- --cpfs cpfs-candidatos.txt --limite 100 --telas 3 --confirmar-cadastro
```

Esses comandos enviam cadastros ao ambiente. O script registra cadastros confirmados e também sincroniza CPFs quando identifica que o candidato já existe no portal. A senha de teste configurada no cadastro e nas inscrições é `Teste123`; contas existentes precisam ter a senha esperada pelos scripts.

### 3. Escolher a inscrição: processo comum ou Lato por CSV

Para o processo comum, a saída do cadastro já é a entrada da inscrição. Substitua os textos entre aspas pelos nomes exibidos no portal:

```powershell
npm.cmd run selecionar-processo -- --cpfs cpfs-cadastrados.txt --limite 1 --telas 1 --processo "NOME EXATO DO PROCESSO" --curso "NOME EXATO DO CURSO" --categoria "NOME EXATO DA CATEGORIA"
```

Esse comando **confirma a inscrição**. Após conferir um candidato, aumente `--limite` e, se necessário, `--telas` (até 4). Informe uma categoria fixa ou use `--distribuir-categorias`; sem categoria fixa ou distribuição, o script limita a execução a um candidato. O resultado fica em `cpfs-inscritos-processo-seletivo.txt`.

Para Lato com categoria específica por CPF, crie `lista_lato_candidatos.csv`. Estrutura ilustrativa; substitua os marcadores antes de validar:

```csv
cpf;curso;categoria
CPF_DE_TESTE_COM_11_DIGITOS;NOME EXATO DO CURSO;NOME EXATO DA CATEGORIA
```

Inclua somente candidatos já cadastrados. A inscrição lê os CPFs desse CSV, sem consultar automaticamente `cpfs-cadastrados.txt`. Valide o arquivo, teste o preenchimento sem concluir e depois confirme um candidato:

```powershell
npm.cmd run inscrever-lato-csv -- --csv lista_lato_candidatos.csv --validar-csv
npm.cmd run inscrever-lato-csv -- --csv lista_lato_candidatos.csv --processo "NOME EXATO DO PROCESSO" --limite 1 --telas 1 --somente-validar-documentos
npm.cmd run inscrever-lato-csv -- --csv lista_lato_candidatos.csv --processo "NOME EXATO DO PROCESSO" --limite 1 --telas 1
```

Depois da conferência, aumente `--limite`. Sem esse parâmetro, a inscrição Lato percorre todo o CSV e confirma os pendentes. O PDF padrão para upload é `docs_testes/pdf_teste.pdf`; use `--documento-pdf` para outro documento de teste. O resultado fica em `inscricoes-lato-confirmadas.jsonl`.

### 4. Preparar as notas para avaliação e alteração

Após a inscrição Lato, crie `lista_lato_candidato.csv` com o nome completo que aparece no portal, o mesmo CPF e as notas de cada candidato. Estrutura ilustrativa:

```csv
nome;cpf;nota 1;nota 2
NOME COMPLETO NO PORTAL;CPF_DE_TESTE_COM_11_DIGITOS;80;75
```

Use um CPF por linha, sem duplicatas. Notas aceitam valores de 0 a 100 e até duas casas decimais. A categoria é opcional nesse arquivo e não define as notas. Confira os rótulos dos quesitos, o processo e o curso conforme a seção de avaliação abaixo.

```powershell
npm.cmd run avaliar-curricular -- --csv lista_lato_candidato.csv --validar-csv
```

Para alterar avaliações já salvas, prepare `atualizacao_notas_lato.csv` no mesmo formato, com as novas notas:

```powershell
npm.cmd run alterar-curricular -- --csv atualizacao_notas_lato.csv --validar-csv
```

Os comandos de validação acima só leem os arquivos locais. Para acessar o SIGAA e salvar avaliações, siga as instruções de credenciais e confirmação nas seções abaixo.

### Retomar o fluxo e resolver erros de entrada

- **Arquivo não encontrado:** confira o nome e a pasta; os arquivos de dados precisam ser criados localmente. No Windows, habilite a exibição de extensões para evitar `.txt.txt` ou `.csv.csv`.
- **CPF inválido ou repetido:** corrija a lista de origem e preserve zeros à esquerda; não substitua por um CPF aleatório.
- **Nenhum candidato pendente:** confira os registros de conclusão e o processo selecionado. Mantenha esses registros ao retomar uma execução.
- **Candidato já cadastrado:** use uma lista local de contas existentes com `--cpfs` na inscrição, desde que a senha delas corresponda à configurada no script.
- **Nome/CPF divergente na avaliação:** confira a identidade no portal e corrija a linha correspondente do CSV antes de executar novamente.

Não preencha nem apague manualmente os checkpoints `cpfs-inscritos-processo-seletivo.txt` e `inscricoes-lato-confirmadas.jsonl` para forçar uma nova tentativa. Eles registram as inscrições verificadas no portal. Preserve também `cpfs-cadastrados.txt` para retomar o cadastro. Arquivos próprios informados por `--cpfs` ou `--csv` devem ser adicionados ao `.gitignore` antes de um commit.

## Referência dos fluxos

### Inscrever candidatos Lato Sensu a partir do CSV

`automacao-processo-seletivo-interno.js` foi reconstruído para inscrever os candidatos de `lista_lato_candidatos.csv` no SIGPS. Usa CPF como login e senha `Teste123`, o processo `PROCESSO SELETIVO INTERNO LATO SENSU 2026.2 - PSIMUW44H9V` e o curso `PROGRAMA DE RESIDÊNCIA EM VIGILÂNCIA EM SAÚDE- VIGILÂNCIA E QUALIDADE`.

A categoria sempre vem da linha do CPF no CSV. Uma coluna `curso` opcional permite definir um curso por candidato; sem essa coluna, usa o curso padrão ou `--curso`. As colunas de notas não são usadas na inscrição. Os dados pessoais complementares de teste ficam no objeto `testData`, e o PDF `docs_testes/pdf_teste.pdf` é anexado aos campos de documentação.

Validar a lista localmente:

```powershell
npm.cmd run inscrever-lato-csv -- --validar-csv
```

Testar um candidato até o resumo, sem confirmar:

```powershell
npm.cmd run inscrever-lato-csv -- --limite 1 --somente-validar-documentos
```

Inscrever toda a lista:

```powershell
npm.cmd run inscrever-lato-csv
```

Use `--limite N` para restringir a quantidade de pendentes e `--telas 1-4` para configurar contextos isolados. Também aceita `--csv`, `--processo`, `--curso` e `--documento-pdf`. O checkpoint `inscricoes-lato-confirmadas.jsonl` registra apenas inscrições verificadas em Meus Processos Seletivos e permite retomar o lote. Uma alteração de curso/categoria para um CPF já registrado interrompe a execução para conferência.

### Auto-cadastro de candidatos

Prepare `cpfs-candidatos.txt` com um CPF autorizado por linha ou separado por virgulas. O padrao de entrada pode ser alterado com `--cpfs`.

Teste pequeno:

```powershell
npm.cmd run cadastrar-candidatos -- --cpfs 100_cpfs_validos.txt --limite 1 --telas 1 --confirmar-cadastro
```

Lote de ate 100 candidatos em tres paginas:

```powershell
npm.cmd run cadastrar-candidatos -- --cpfs 100_cpfs_validos.txt --limite 100 --telas 3 --confirmar-cadastro
```

`--confirmar-cadastro` e obrigatorio porque envia formularios reais ao ambiente. O script valida formato, digitos verificadores e duplicidades; ignora CPFs ja registrados; e so salva o CPF em `cpfs-cadastrados.txt` depois de confirmar o cadastro.

### Inscricao em processo seletivo

Teste em um candidato:

```powershell
npm.cmd run selecionar-processo -- --limite 1 --telas 1 --distribuir-categorias
```

Lote de CPFs pendentes, usando tres telas e alternando cursos e categorias:

```powershell
npm.cmd run selecionar-processo -- --cpfs cpfs-cadastrados.txt --limite 700 --telas 3 --distribuir-cursos --distribuir-categorias
```

O processo e o curso podem ser trocados por parametros. Sem parametros, o script usa o processo interno configurado e o curso `CIÊNCIAS HUMANAS - CODÓ - Noturno`. Para alternar cursos, use `--distribuir-cursos`; o rodizio segue a ordem das opcoes de curso carregadas pelo processo no portal.

Atualmente, `CIÊNCIAS HUMANAS - CODÓ - Presencial - N - LICENCIATURA PLENA - 2010` esta temporariamente excluido da selecao. A exclusao fica na constante `excludedCourseNames` de `automacao-inscricao-processo-seletivo.js`; remova o item dessa lista quando puder voltar a usar o curso.

```powershell
npm.cmd run selecionar-processo -- --limite 1 --telas 1 --processo "NOME EXATO DO PROCESSO" --curso "CIÊNCIAS HUMANAS - CODÓ - Noturno" --ano-enem 2025 --categoria "AC - Ampla Concorrência"
```

Opcoes principais:

- `--cpfs arquivo.txt`: arquivo de CPFs; padrao `cpfs-cadastrados.txt`.
- `--limite N`: quantidade maxima a processar; padrao `1`.
- `--telas N`: concorrencia de 1 a 4 paginas; padrao `3`.
- `--processo nome`: nome exato do processo exibido no SIGPS.
- `--curso nome`: nome exato do curso; padrao `CIÊNCIAS HUMANAS - CODÓ - Noturno`.
- `--distribuir-cursos`: alterna os cursos disponiveis na ordem retornada pelo portal, usando a posicao original do CPF.
- `--ano-enem ano`: ano de avaliacao ENEM; padrao `2025`.
- `--categoria nome`: seleciona uma categoria pelo texto exato exibido pelo portal, incluindo acentos e descricao.
- `--distribuir-categorias`: alterna as categorias na ordem retornada pelo portal, usando a posicao do CPF na lista.

Use `--curso` ou `--distribuir-cursos`, e `--categoria` ou `--distribuir-categorias`; nao combine os dois modos de cada escolha. O checkpoint `cpfs-inscritos-processo-seletivo.txt` guarda CPF, processo, curso e categoria confirmados. O script verifica a inscricao em “Meus Processos Seletivos” antes de gravar e ignora candidatos ja inscritos no mesmo processo, mesmo que o curso registrado seja diferente.

### Consultar Análise Curricular

O script abre o caso de uso, seleciona primeiro o processo e depois o curso, executa a busca e deixa a lista aberta para consulta. Ele não abre solicitações individuais nem altera análises. O processo Lato usado recentemente é o padrão; informe o curso como trecho ou nome do curso:

```powershell
npm.cmd run analise-curricular -- --curso "ASSESSORIA DE COMUNICAÇÃO EMPRESARIAL"
```

O outro curso disponível no processo é `MONITORAMENTO DE MÍDIAS SOCIAIS E MARKETING POLÍTICO`. Para consultar outro processo, acrescente `--processo "TRECHO DO PROCESSO"`.

### Avaliar Análise Curricular com notas do CSV

`automacao-avaliar-curricular-lote.js` usa `lista_lato_candidato.csv`. O processo padrão é `PROCESSO SELETIVO INTERNO LATO SENSU 2026.2 - PSIMUW44H9V`; o curso padrão é `PROGRAMA DE RESIDÊNCIA EM VIGILÂNCIA EM SAÚDE- VIGILÂNCIA E QUALIDADE/HU/SUP`.

Cada CPF deve aparecer uma única vez. A automação abre o candidato pelo nome completo e exige que o CPF completo e o nome exibidos no portal correspondam à mesma linha do CSV. Antes de preencher qualquer avaliação, audita as identidades de todo o lote selecionado. Nomes ambíguos, CPF divergente, notas inválidas ou quesitos inesperados interrompem a execução. A ordem da lista não determina as notas.

`nota 1` preenche `TEM CARRO?` e `nota 2` preenche `TEM MOTO`; use `--quesito-1` e `--quesito-2` para outros rótulos. Todos os documentos ficam DEFERIDOS. A observação padrão é `Aprovado`, configurável com `--observacao`. O resumo é conferido novamente por CPF, nome, processo, curso e as duas notas antes de qualquer confirmação.

Validar o CSV e executar os testes locais:

```powershell
npm.cmd run avaliar-curricular -- --validar-csv
npm.cmd run test:avaliacao
```

Para acessar o portal, informe a senha da conta autorizada no ambiente da sessão (usuário padrão `marcos.lauande`; outro usuário via `SIGAA_USERNAME`):

```powershell
$secure = Read-Host "Senha de acesso SIGAA" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:SIGAA_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    npm.cmd run avaliar-curricular -- --auditar-identidades
    npm.cmd run avaliar-curricular -- --limite 3
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    Remove-Item Env:SIGAA_PASSWORD -ErrorAction SilentlyContinue
}
```

`--auditar-identidades` confere todos os pendentes sem preencher notas. Sem `--confirmar`, o script preenche e verifica o resumo e retorna à lista sem salvar a avaliação; por padrão testa um candidato. Use `--limite N` ou `--todos-pendentes` para ampliar o lote. A execução é sequencial.

Para salvar avaliações, defina também `SIGAA_ANALYSIS_PASSWORD` com a senha de confirmação autorizada e acrescente `--confirmar`. Após cada confirmação, o script verifica o status AVALIADO na lista. Qualquer falha interrompe o lote; candidatos já avaliados não entram na busca de pendentes. Não há geração de notas aleatórias nem indeferimento de documentos por posição.

### Alterar análises curriculares já avaliadas

`automacao-alterar-curricular-lote.js` filtra por **AVALIADO** e abre **Alterar Análise Curricular**. Usa `atualizacao_notas_lato.csv`, com `nome;cpf;nota 1;nota 2;categoria`. Também reconhece o arquivo local `atualizacao_notas_lato.csv.csv` enquanto ele estiver com a extensão duplicada. Use `--csv` para informar outro caminho.

Antes do preenchimento, confere CPF completo e nome de todos os candidatos selecionados. Limpa cada campo cuja nota precisa mudar, preenche a nova nota e aguarda a resposta Ajax antes de avançar. Nota 1 corresponde a `TEM CARRO?` e nota 2 a `TEM MOTO`. Documentos e observações são preservados; `--observacao` permite substituir a observação explicitamente. Candidatos cujas duas notas já correspondem ao CSV são ignorados. O CSV pode conter um subconjunto dos candidatos avaliados; candidatos ausentes ou ambíguos bloqueiam o lote.

Validação local:

```powershell
npm.cmd run alterar-curricular -- --validar-csv
```

Com `SIGAA_PASSWORD` definida para a conta autorizada, testar três candidatos até o resumo, sem salvar:

```powershell
npm.cmd run alterar-curricular -- --limite 3
```

Auditar as identidades de todos os candidatos do CSV sem preencher notas:

```powershell
npm.cmd run alterar-curricular -- --auditar-identidades
```

Para salvar todas as alterações, defina também `SIGAA_ANALYSIS_PASSWORD` e execute:

```powershell
npm.cmd run alterar-curricular -- --todos-avaliados --confirmar
```

Sem `--confirmar`, o script não salva nenhuma alteração. Com confirmação, abre **Visualizar Análise Curricular** após cada envio para conferir as notas persistidas, identidade, documentos e observação. Qualquer divergência interrompe o lote. O processo e o curso padrão são os mesmos da automação de avaliação; ambos aceitam parâmetros.

### Arquivo de notas ENEM

`modelo_importacao_notas_enem.csv` e o modelo de importacao; mantenha seus nomes e ordem de colunas. `notas-enem-candidatos-teste_curso_1.csv` e a massa de teste no mesmo formato, separada por ponto e virgula (`;`), com 700 registros: notas baixas, empates em 650, notas altas e, em cada grupo de 100, sete candidatos sem presenca em nenhuma prova mais tres candidatos com ausencia parcial em uma area.

O arquivo de notas e para importacao de teste, nao e gerado por um dos scripts de navegador.

## Parametros para alteracao

- No auto-cadastro, os defaults de arquivo, URL, limite e paginas ficam no inicio de `automacao-auto-cadastro-candidatos.js`. O objeto `candidateDefaults` guarda data de nascimento, prefixo de nome/e-mail, dominio, senha e preferencias dos selects. Selects vazios usam a primeira opcao valida do portal; para escolher outra, informe parte do texto da opcao.
- Na inscricao, altere `defaultProcessName`, `defaultCourseName`, `enemYear` e o objeto `testData` no inicio de `automacao-inscricao-processo-seletivo.js`. Esses campos sao aplicados aos candidatos do lote.
- Na inscrição Lato por CSV, use os parâmetros de `automacao-processo-seletivo-interno.js`; a categoria vem obrigatoriamente do CSV e o curso pode ser definido por linha ou por `--curso`.

Prefira validar alteracoes com `--limite 1 --telas 1` antes de executar um lote.

## Arquivos

- `automacao-processo-seletivo-interno.js`: inscreve candidatos Lato Sensu do CSV com curso/categoria vinculados ao CPF.
- `automacao-auto-cadastro-candidatos.js`: auto-cadastra candidatos a partir de uma lista validada de CPFs.
- `automacao-inscricao-processo-seletivo.js`: autentica cada candidato, preenche a inscricao, escolhe curso/categoria, confirma e valida o resultado no SIGPS.
- `automacao-analise-curricular.js`: consulta solicitações de análise curricular filtradas por processo seletivo e curso.
- `automacao-avaliar-curricular-lote.js`: preenche e confirma análises curriculares pendentes com resumo validado antes de cada envio.
- `100_cpfs_validos.txt`: lista de origem usada na massa de candidatos de teste.
- `cpfs-candidatos.txt`: nome padrao esperado como entrada do auto-cadastro; pode ser substituido por `--cpfs`.
- `cpfs-cadastrados.txt`: CPFs cujos auto-cadastros foram confirmados; entrada padrao da automacao de inscricao.
- `cpfs-inscritos-processo-seletivo.txt`: checkpoint de inscricoes confirmadas; nao editar manualmente.
- `cpfs-processo-selecionado.txt`: checkpoint legado de uma versao anterior do seletor; a automacao atual nao consulta esse arquivo.
- `modelo_importacao_notas_enem.csv`: cabecalho e estrutura de referencia para importacao.
- `notas-enem-candidatos-teste_curso_1.csv`: dados de notas ENEM preparados para cenarios de teste.
- `package.json` e `package-lock.json`: comandos npm e versao das dependencias Playwright.
- `.gitignore`: exclui CPFs, checkpoints e CSVs com dados de teste.
- `sigaa-processo-seletivo-interno.png`: captura gerada pela automacao antiga de criacao de processo.
- `UFMA - Pré-Orçamento - SIGAA - SIGPS 2026_GRADUAÇÃO E LATO.pdf`: documento de referencia; nao e lido pelos scripts.

Os arquivos `cpfs-cadastrados.txt`, `cpfs-inscritos-processo-seletivo.txt` e as listas/CSVs de teste contem identificadores e devem permanecer locais.
