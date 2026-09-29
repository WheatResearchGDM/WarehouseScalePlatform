# Warehouse Scale Platform

Aplicativo operacional para pesagem de parcelas em ensaios de trigo.

## Aplicativo publicado

[Abrir o aplicativo no GitHub Pages](https://wheatresearchgdm.github.io/WarehouseScalePlatform/)

A versão do GitHub Pages salva os pesos no navegador do equipamento e atualiza o
relatório imediatamente. Para sincronização entre vários aparelhos, use a versão
com backend Cloudflare D1 descrita abaixo.

A conexão com a balança requer Chrome ou Edge, acesso por HTTPS e autorização do
operador para a porta serial. A configuração padrão é 9600 baud e pode ser alterada
na própria tela antes da conexão.

## Funcionalidades

- leitura de parcelas por FEID ou UUID, compatível com leitores que funcionam como teclado;
- conferência de Entity name, (OBS) Name, Block, Entry code, Row, Column e (GER) Name;
- registro e atualização do PW (Plot weight);
- conexão direta com balanças pela porta COM usando Web Serial, com velocidade configurável;
- fator de escala configurável de `10⁰` a `10⁶` para normalizar a leitura bruta da balança;
- preenchimento automático do PW a partir da leitura serial;
- importação de arquivos Excel `.xlsx` ou `.xls` pelo operador;
- exportação das parcelas pesadas em CSV compatível com Excel;
- progresso em tempo real por ensaio, calculado pelos intervalos Initial plot e Final plot;
- interface responsiva com a identidade visual da GDM;
- persistência em Cloudflare D1 e atualização automática entre dispositivos.

## Dados

O aplicativo inicia sem uma base fixa. O operador deve importar a primeira aba de um Excel que contenha os cabeçalhos: `ID`, `FEID`, `UUID`, `Entity name`, `Trial type`, `Site`, `Location`, `Row`, `Column`, `Entry code`, `Block`, `(OBS) Name`, `GID`, `(GER) Name`, `Initial plot`, `Final plot` e `PW`. A planilha importada fica salva no navegador do equipamento.

## Desenvolvimento

Requisitos: Node.js 22.13 ou superior.

```bash
npm ci
npm run db:generate
npm run build
npm run dev
```

O banco utiliza o binding D1 `DB`. Para a prévia local, aplique a migração gerada em `drizzle/` ao banco local do Wrangler antes de testar gravações.

## Estrutura principal

- `app/page.tsx`: fluxo operacional e painel de progresso;
- `app/api/weights/route.ts`: leitura e gravação dos pesos;
- `index.html` e `pages/`: versão estática publicada no GitHub Pages;
- `public/plot-import.js`: validação e transformação da planilha importada;
- `db/schema.ts`: tabela de pesagens;
- `drizzle/`: migrações do banco.
