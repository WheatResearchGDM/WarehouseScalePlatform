# Warehouse Scale Platform

Aplicativo operacional para pesagem de parcelas em ensaios de trigo.

## Aplicativo publicado

[Abrir o aplicativo no GitHub Pages](https://wheatresearchgdm.github.io/WarehouseScalePlatform/)

A versão do GitHub Pages salva os pesos no navegador do equipamento e atualiza o
relatório imediatamente. Para sincronização entre vários aparelhos, use a versão
com backend Cloudflare D1 descrita abaixo.

## Funcionalidades

- leitura de parcelas por FEID ou UUID, compatível com leitores que funcionam como teclado;
- conferência de Entity name, (OBS) Name, Block, Entry code, Row, Column e (GER) Name;
- registro e atualização do PW (Plot weight);
- progresso em tempo real por ensaio, calculado pelos intervalos Initial plot e Final plot;
- interface responsiva com a identidade visual da GDM;
- persistência em Cloudflare D1 e atualização automática entre dispositivos.

## Dados

A base em `data/plots.json` contém 698 parcelas distribuídas em três ensaios:

- `EYT_P_K26_Ivaipora`: 510 parcelas;
- `PRYT_P_K26_Apucarana`: 108 parcelas;
- `VCU_P_K26_Coamo`: 80 parcelas.

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
- `data/plots.json`: cadastro das parcelas;
- `db/schema.ts`: tabela de pesagens;
- `drizzle/`: migrações do banco.
