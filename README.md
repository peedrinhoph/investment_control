# Patrimônio — PWA local-first

Controle de investimentos, patrimônio, proventos e apoio ao IR. Os dados ficam só no navegador (LocalStorage + IndexedDB).

## Rodar
O app usa módulos JavaScript, então precisa ser servido por HTTP(S) — abrir o `index.html` direto pelo arquivo não funciona.

- Teste local: `python -m http.server 8080` (ou `npx serve`) nesta pasta e abra http://localhost:8080
- Produção: publique a pasta em qualquer hospedagem estática com HTTPS (o backup com senha e o modo offline exigem HTTPS).

## Publicar uma atualização
Altere `VERSION` em `sw.js` (e `APP_VERSION` em `js/config.js`). Quem estiver com o app aberto verá "Nova versão disponível".

## Estrutura
- `js/config.js` — constantes e regras (tipos de movimentação, classes, indexadores)
- `js/store.js` — estado, validação, migração e gravação
- `js/finance.js` — posição, custo médio, eventos, renda fixa, dólar, totais
- `js/planning.js` — calculadora de aporte, independência financeira, concentração
- `js/tax.js` — bens e direitos, rendimentos, apuração mensal de renda variável
- `js/b3.js` — leitura de .xlsx/.csv e importação dos extratos da B3
- `js/crypto.js` — backup criptografado (PBKDF2 + AES-GCM)
- `js/quotes.js` — cotações/indicadores automáticos (opcional; novos provedores em `PROVIDERS`)
- `js/forms.js`, `js/data.js`, `js/views/*` — telas e formulários
- `js/main.js` — inicialização, navegação e eventos
