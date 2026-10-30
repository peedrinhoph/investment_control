/* Constantes e regras de domínio compartilhadas por todo o app. */
export const APP_VERSION = '4.0.0';
export const SCHEMA_VERSION = 4;

export const DB_NAME = 'patrimonio-investimentos-db', DB_VERSION = 1, STORE = 'records';
export const STATE_KEY = 'patrimonio-app-state-v1', PREF_KEY = 'patrimonio-prefs-v1';
export const BACKUP_PREFIX = 'patrimonio-pre-', KEEP_BACKUPS = 3;

export const EPS = 1e-8, STALE_DAYS = 7, BACKUP_DAYS = 30, TX_PAGE = 200, RF_MATURITY_ALERT_DAYS = 30;
export const IR_EXEMPT_STOCKS = 20000, DARF_MIN = 10;

/**
 * Tipos de movimentação.
 * asset: 'required' | 'optional' | 'none'
 * qty: usa quantidade × preço · ratio: usa fator (eventos de desdobramento/grupamento)
 * income: grupo fiscal do provento ('isento' | 'exclusivo' | 'tributavel')
 */
export const TX_TYPES = {
  COMPRA:        { label: 'Compra', asset: 'required', qty: true, pill: 'blue' },
  VENDA:         { label: 'Venda', asset: 'required', qty: true, pill: 'yellow' },
  DIVIDENDO:     { label: 'Dividendo', asset: 'optional', income: 'isento', pill: 'green' },
  RENDIMENTO:    { label: 'Rendimento (FII)', asset: 'optional', income: 'isento', pill: 'green' },
  JCP:           { label: 'JCP', asset: 'optional', income: 'exclusivo', pill: 'green' },
  JUROS:         { label: 'Juros / renda fixa', asset: 'optional', income: 'tributavel', pill: 'green' },
  BONIFICACAO:   { label: 'Bonificação', asset: 'required', qty: true, event: true, pill: 'purple' },
  DESDOBRAMENTO: { label: 'Desdobramento', asset: 'required', ratio: true, event: true, pill: 'purple' },
  GRUPAMENTO:    { label: 'Grupamento', asset: 'required', ratio: true, event: true, pill: 'purple' },
  APORTE:        { label: 'Aporte externo', asset: 'none', pill: '' },
  RETIRADA:      { label: 'Retirada', asset: 'none', pill: 'red' },
  TAXA:          { label: 'Taxa / custo', asset: 'optional', pill: 'red' }
};
export const INCOME_TYPES = Object.keys(TX_TYPES).filter(k => TX_TYPES[k].income);
export const ANNOUNCE_TYPES = ['DIVIDENDO', 'JCP', 'RENDIMENTO'];
export const JCP_NET = 0.85;

export const ASSET_CLASSES = ['Ação', 'FII', 'ETF', 'BDR', 'Renda fixa', 'Cripto', 'Exterior', 'Caixa', 'Outro'];
export const WHOLE_UNITS = ['Ação', 'FII', 'ETF', 'BDR'];
export const CURRENCIES = { BRL: 'Real (R$)', USD: 'Dólar (US$)' };

/** Indexadores de renda fixa. A taxa do ativo significa: PRE = % a.a.; CDI = % do CDI; SELIC/IPCA = spread % a.a. */
export const INDEXERS = {
  PRE:   { label: 'Prefixado', rateLabel: 'Taxa (% a.a.)', short: r => `${r}% a.a.` },
  CDI:   { label: '% do CDI', rateLabel: 'Percentual do CDI (%)', short: r => `${r}% CDI` },
  SELIC: { label: 'Selic + spread', rateLabel: 'Spread (% a.a.)', short: r => `Selic + ${r}%` },
  IPCA:  { label: 'IPCA + spread', rateLabel: 'Spread (% a.a.)', short: r => `IPCA + ${r}%` }
};

/** Sugestão de grupo/código para a ficha Bens e Direitos (confira no programa da Receita). */
export const IR_GROUPS = {
  'Ação':       { code: '03 · 01', label: 'Ações' },
  'FII':        { code: '07 · 03', label: 'Fundos imobiliários' },
  'ETF':        { code: '07 · (confira)', label: 'Fundos de índice' },
  'BDR':        { code: '04 · 04', label: 'Ativos negociados em bolsa' },
  'Renda fixa': { code: '04 · 02 ou 04 · 03', label: 'Títulos (tributados ou isentos)' },
  'Cripto':     { code: '08 · (confira)', label: 'Criptoativos' },
  'Exterior':   { code: '(confira)', label: 'Aplicações no exterior' },
  'Caixa':      { code: '06 · (confira)', label: 'Depósitos à vista' },
  'Outro':      { code: '(confira)', label: 'Outros' }
};

export const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const PAGES = ['dashboard', 'portfolio', 'transactions', 'income', 'plan', 'wealth', 'reports'];

export const WEALTH = {
  account:   { key: 'accounts', label: 'Conta ou reserva', amount: 'balance', amountLabel: 'Saldo atual (R$)', allowNeg: true,
               types: ['Conta corrente', 'Poupança', 'Reserva de emergência', 'Dinheiro', 'Saldo em corretora', 'Outro'] },
  property:  { key: 'properties', label: 'Bem', amount: 'value', amountLabel: 'Valor estimado atual (R$)',
               types: ['Imóvel', 'Veículo', 'Equipamento', 'Outro bem'] },
  liability: { key: 'liabilities', label: 'Dívida / passivo', amount: 'balance', amountLabel: 'Saldo devedor atual (R$)',
               types: ['Financiamento', 'Empréstimo', 'Cartão de crédito', 'Consignado', 'Outra dívida'] }
};
