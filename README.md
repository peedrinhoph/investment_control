# Patrimônio — PWA local-first

Controle de investimentos, patrimônio, proventos e apoio ao IR. Os dados ficam só no navegador (LocalStorage + IndexedDB).

## Rodar
O app usa módulos JavaScript, então precisa ser servido por HTTP(S) — abrir o `index.html` direto pelo arquivo não funciona.

- Teste local: `python -m http.server 8080` (ou `npx serve`) nesta pasta e abra http://localhost:8080

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

## Telas
<img width="896" height="1332" alt="image" src="https://github.com/user-attachments/assets/6352e108-0a7f-43cd-889e-7cfb5b4d1c70" />

<img width="982" height="1204" alt="image" src="https://github.com/user-attachments/assets/b212fcc9-ccec-4e7c-acba-89c49bd6578f" />

<img width="390" height="1548" alt="image" src="https://github.com/user-attachments/assets/430e2943-3a22-49de-b6da-8ad09baf7127" />

<img width="812" height="1458" alt="image" src="https://github.com/user-attachments/assets/ea7cff18-6718-4b35-990b-b12851247e3e" />


