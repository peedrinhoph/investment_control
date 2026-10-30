/* Cálculos financeiros: posição, custo médio, eventos, renda fixa, dólar, totais e proventos. */
import { TX_TYPES, INCOME_TYPES, EPS, JCP_NET } from './config.js';
import { state, rev, getAsset } from './store.js';
import { num, today, monthNow, addMonths, daysBetween, parseDate } from './utils.js';

export const sortTx = list => [...list].sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
export const fxOf = t => num(t.fx) || 1;
/** Valor em reais de uma movimentação (eventos de fator não têm valor). */
export function txValue(t) {
  const c = TX_TYPES[t.type];
  if (c.ratio) return 0;
  if (c.qty) return num(t.quantity) * num(t.unitPrice) * fxOf(t);
  return num(t.total) * fxOf(t);
}
/** Valor na moeda do ativo. */
export const txValueCur = t => TX_TYPES[t.type].qty ? num(t.quantity) * num(t.unitPrice) : TX_TYPES[t.type].ratio ? 0 : num(t.total);

const newHolding = () => ({ qty: 0, cost: 0, costCur: 0, realized: 0, income: 0, sales: [], lots: [], negativeAt: '' });
export const EMPTY_H = Object.freeze(newHolding());

function consumeLots(lots, q) {
  while (q > EPS && lots.length) {
    const l = lots[0];
    if (l.qty <= q + EPS) { q -= l.qty; lots.shift(); }
    else { const f = (l.qty - q) / l.qty; l.principal *= f; l.qty -= q; q = 0; }
  }
}

/**
 * Percorre as movimentações em ordem e calcula, por ativo: quantidade, custo (R$ e moeda do ativo),
 * resultado realizado, proventos, vendas e lotes (usados na marcação da renda fixa).
 * `until`: considera só movimentações até essa data (inclusive).
 */
export function buildLedger(list = state.transactions, until = '') {
  const L = {};
  const get = tk => L[tk] || (L[tk] = newHolding());
  for (const t of sortTx(list)) {
    if (until && t.date > until) break;
    if (!t.assetTicker) continue;
    const h = get(t.assetTicker), q = num(t.quantity), p = num(t.unitPrice), fee = num(t.fee), fx = fxOf(t);
    switch (t.type) {
      case 'COMPRA': {
        const c = (q * p + fee) * fx;
        h.qty += q; h.cost += c; h.costCur += q * p + fee;
        h.lots.push({ date: t.date, qty: q, principal: c });
        break;
      }
      case 'BONIFICACAO': {
        const c = q * p * fx;
        h.qty += q; h.cost += c; h.costCur += q * p;
        h.lots.push({ date: t.date, qty: q, principal: c });
        break;
      }
      case 'DESDOBRAMENTO': case 'GRUPAMENTO': {
        const r = num(t.ratio) || 1;
        h.qty *= r; h.lots.forEach(l => { l.qty *= r; });
        break;
      }
      case 'VENDA': {
        if (q > h.qty + EPS && !h.negativeAt) h.negativeAt = t.date;
        const sold = Math.min(q, h.qty), avg = h.qty > EPS ? h.cost / h.qty : 0, avgCur = h.qty > EPS ? h.costCur / h.qty : 0;
        const result = (sold * p - fee) * fx - avg * sold;
        h.realized += result;
        h.sales.push({ date: t.date, ticker: t.assetTicker, gross: sold * p * fx, result });
        h.qty -= sold; h.cost -= avg * sold; h.costCur -= avgCur * sold;
        consumeLots(h.lots, sold);
        if (h.qty < EPS) { h.qty = 0; h.cost = 0; h.costCur = 0; h.lots = []; }
        break;
      }
      default:
        if (TX_TYPES[t.type].income) h.income += num(t.total) * fx;
    }
  }
  return L;
}

let ledgerCache = null, ledgerRev = -1, holdingCache = new Map(), holdingRev = -1;
export function ledger() {
  if (ledgerRev !== rev) { ledgerCache = buildLedger(); ledgerRev = rev; }
  return ledgerCache;
}
export function positionAt(ticker, date, list = state.transactions) {
  return buildLedger(list.filter(t => t.assetTicker === ticker), date)[ticker]?.qty || 0;
}
/** Primeiro ativo cuja posição ficaria negativa com a lista informada. */
export function sequenceError(list, tickers) {
  const L = buildLedger(list.filter(t => tickers.includes(t.assetTicker)));
  for (const tk of tickers) if (L[tk]?.negativeAt) return { ticker: tk, date: L[tk].negativeAt };
  return null;
}

/* ---------- Dólar ---------- */
export function usdRate() {
  const r = num(state.settings.fx.USD.rate);
  if (r > 0) return r;
  const last = sortTx(state.transactions).reverse().find(t => num(t.fx) > 1);
  return last ? num(last.fx) : 0;
}
export const hasUsdAssets = () => state.assets.some(a => a.currency === 'USD');

/* ---------- Renda fixa ---------- */
/** Dias úteis (segunda a sexta) entre duas datas, sem feriados. */
export function businessDays(from, to) {
  if (!(to > from)) return 0;
  const a = parseDate(from), days = daysBetween(from, to), full = Math.floor(days / 7);
  let du = full * 5;
  const d = new Date(a); d.setDate(d.getDate() + full * 7);
  for (let i = full * 7; i < days; i++) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) du++; }
  return du;
}
/** Fator de correção de um título entre duas datas, pelo indexador e indicadores informados. */
export function rfFactor(fixed, from, to) {
  const end = fixed.maturity && fixed.maturity < to ? fixed.maturity : to;
  const du = businessDays(from, end), y = du / 252, r = num(fixed.rate) / 100, R = state.settings.rates;
  switch (fixed.indexer) {
    case 'PRE': return Math.pow(1 + r, y);
    case 'CDI': { const daily = Math.pow(1 + num(R.cdi) / 100, 1 / 252) - 1; return Math.pow(1 + daily * r, du); }
    case 'SELIC': return Math.pow(1 + num(R.selic || R.cdi) / 100, y) * Math.pow(1 + r, y);
    case 'IPCA': return Math.pow(1 + num(R.ipca) / 100, y) * Math.pow(1 + r, y);
    default: return 1;
  }
}
/** Alíquota regressiva do IR sobre renda fixa. */
export const irRegressivo = days => days <= 180 ? 0.225 : days <= 360 ? 0.2 : days <= 720 ? 0.175 : 0.15;
export const isAutoRF = a => a.assetClass === 'Renda fixa' && !!a.fixed?.indexer && a.quoteMode !== 'manual';
export const rfNeedsRates = () => state.assets.some(a => isAutoRF(a) && holding(a).open && (
  (a.fixed.indexer === 'CDI' && !(state.settings.rates.cdi > 0)) ||
  (a.fixed.indexer === 'SELIC' && !(state.settings.rates.selic > 0 || state.settings.rates.cdi > 0)) ||
  (a.fixed.indexer === 'IPCA' && !(state.settings.rates.ipca > 0))));

/* ---------- Posição avaliada ---------- */
/**
 * Posição de um ativo com valor de mercado em R$.
 * priceCur: preço na moeda do ativo (renda fixa automática: valor estimado por unidade).
 * net: valor líquido estimado após IR (só renda fixa automática).
 */
export function holding(a) {
  if (holdingRev !== rev) { holdingCache = new Map(); holdingRev = rev; }
  const cached = holdingCache.get(a.ticker);
  if (cached) return cached;
  const h = ledger()[a.ticker] || EMPTY_H, open = h.qty > EPS;
  let market = 0, priceCur = num(a.quote), estimated = false, net = null, rate = 1;
  if (open) {
    if (isAutoRF(a)) {
      const t = today(); let gross = 0, tax = 0;
      for (const l of h.lots) {
        const v = l.principal * rfFactor(a.fixed, l.date, t);
        gross += v;
        if (!a.fixed.taxExempt) tax += Math.max(0, v - l.principal) * irRegressivo(daysBetween(l.date, t));
      }
      market = gross; net = gross - tax; priceCur = gross / h.qty; estimated = true;
    } else {
      rate = a.currency === 'USD' ? usdRate() : 1;
      market = h.qty * num(a.quote) * rate;
    }
  }
  const out = { ...h, open, avg: open ? h.cost / h.qty : 0, avgCur: open ? h.costCur / h.qty : 0, market, priceCur, estimated, net, rate, unrealized: open ? market - h.cost : 0 };
  holdingCache.set(a.ticker, out);
  return out;
}
/** Preço de uma unidade em reais (para a calculadora de aporte). */
export function priceBRL(a) {
  if (isAutoRF(a)) return holding(a).priceCur;
  return num(a.quote) * (a.currency === 'USD' ? usdRate() : 1);
}

export function portfolioTotals() {
  return state.assets.reduce((o, a) => {
    const h = holding(a);
    o.market += h.market; o.cost += h.cost; o.unrealized += h.unrealized; o.realized += h.realized;
    if (h.open) { o.count++; if (!(a.quote > 0) && !h.estimated) o.noQuote++; }
    return o;
  }, { market: 0, cost: 0, unrealized: 0, realized: 0, count: 0, noQuote: 0 });
}
export const sumType = (types, period = '') => state.transactions.reduce((s, t) => types.includes(t.type) && t.date.startsWith(period) ? s + txValue(t) : s, 0);
export const investedIn = period => state.transactions.reduce((s, t) => t.type === 'COMPRA' && t.date.startsWith(period) ? s + txValue(t) + num(t.fee) * fxOf(t) : s, 0);
export const monthProgress = ym => state.settings.goalBasis === 'APORTE' ? sumType(['APORTE'], ym) : investedIn(ym);
export const allSales = () => Object.values(ledger()).flatMap(h => h.sales);
export function incomeBetween(fromYm, toYm, ticker = null) {
  return state.transactions.reduce((s, t) => {
    const m = t.date.slice(0, 7);
    return TX_TYPES[t.type].income && m >= fromYm && m <= toYm && (!ticker || t.assetTicker === ticker) ? s + txValue(t) : s;
  }, 0);
}
export const income12m = ticker => incomeBetween(addMonths(monthNow(), -11), monthNow(), ticker);

export function wealthTotals() {
  const sum = (list, f) => list.reduce((s, x) => s + num(x[f]), 0);
  const cash = sum(state.accounts, 'balance'), properties = sum(state.properties, 'value'), debt = sum(state.liabilities, 'balance');
  const investments = portfolioTotals().market;
  return { cash, properties, debt, investments, net: cash + properties + investments - debt };
}
export function allocation(key) {
  const out = {};
  for (const a of state.assets) { const v = holding(a).market; if (v > 0) { const k = a[key] || 'Outros'; out[k] = (out[k] || 0) + v; } }
  return out;
}
export const targetSum = () => Object.values(state.settings.targets).reduce((s, v) => s + v, 0);

/* ---------- Agenda de proventos ---------- */
/** Valor estimado (líquido) de um provento anunciado, pela posição na data-com. */
export function announcementEstimate(a) {
  const date = a.dateCom || a.payDate;
  const qty = positionAt(a.ticker, date);
  const asset = getAsset(a.ticker), fx = asset?.currency === 'USD' ? usdRate() || 1 : 1;
  const gross = qty * num(a.perShare) * fx;
  return { qty, gross, net: a.type === 'JCP' ? gross * JCP_NET : gross };
}
export const pendingAnnouncements = () => state.announcements.filter(a => a.status === 'pending').sort((a, b) => a.payDate.localeCompare(b.payDate));
