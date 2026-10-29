# Patrimônio — Etapas 1 e 2 (PWA)

Aplicativo estático, mobile-first, responsivo para computador e preparado para GitHub Pages. Os dados ficam no navegador; não há API nem sincronização em nuvem nesta etapa.

## Publicar no GitHub Pages
1. Extraia o ZIP e envie `index.html`, `manifest.webmanifest`, `sw.js` e `icon.svg` para a raiz do repositório.
2. No GitHub, acesse **Settings → Pages** e publique a branch principal, pasta `/ (root)`.
3. Acesse a URL HTTPS. No iPhone: Safari → Compartilhar → Adicionar à Tela de Início. Android/desktop: use a opção de instalar do navegador.

## Etapa 1 — Fundação e migração
- Mantém as chaves existentes `patrimonio-app-state-v1` e `patrimonio-investimentos-db` / store `records`.
- Migra o estado antigo para schema 2, acrescentando listas vazias para contas, bens e dívidas.
- Antes da migração, tenta guardar uma cópia JSON local do estado anterior em uma chave `patrimonio-pre-migration-*`. Antes de importar um backup, guarda também uma cópia do estado atual em `patrimonio-pre-import-*`.
- Backup JSON com schemaVersion e timestamp; exportação CSV de movimentações.
- Não apaga automaticamente os dados antigos após a migração.

## Ajustes desta versão
- Navegação fixa na parte inferior em telas móveis, com o layout horizontal original mantido em desktop.
- Plano mensal de aporte configurável individualmente para cada ativo, salvo no estado local e incluído nos backups JSON.
- O valor total da movimentação é calculado automaticamente a partir da quantidade e do preço unitário; se o usuário editar o total manualmente, o valor é preservado até que quantidade ou preço unitário sejam alterados novamente.
- Corrigido o vínculo dos eventos do modal de configurações: os botões são ligados somente após o conteúdo do modal existir.

## Etapa 2 — Patrimônio completo
- Contas correntes, poupança, reserva de emergência, dinheiro e corretoras.
- Bens: imóveis, veículos e outros bens com valor estimado atual.
- Passivos: financiamentos, empréstimos, cartão e outras dívidas.
- Resumo de contas, bens, dívidas e patrimônio líquido, incluindo o valor de mercado dos investimentos.
- Edição e exclusão dos registros. Atualizações de saldos patrimoniais não são tratadas como aportes ou renda automaticamente.

## Precisão e limitações
- Saldos de contas, bens e dívidas são informados manualmente. Atualize periodicamente.
- A posição de investimentos depende das movimentações e cotações registradas. As cotações pré-preenchidas são referências editáveis, não preços em tempo real.
- Esta versão não importa extratos bancários, não conecta a corretoras, não faz sincronização entre aparelhos e não possui API.
- LocalStorage e IndexedDB não são backups nem armazenamento criptografado. Exporte o JSON e guarde uma cópia fora do dispositivo regularmente.
- Para recuperar uma migração, use o backup exportado antes da atualização ou os registros locais `patrimonio-pre-migration-*` se ainda estiverem no mesmo navegador.

## Próximas etapas
Cotação por API configurável, histórico de preços, proventos detalhados, testes adicionais de rentabilidade e camada Repository para futura API/sincronização.
