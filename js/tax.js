/* Apoio ao imposto de renda: bens e direitos, rendimentos e apuração mensal de renda variável. */
import { TX_TYPES, IR_GROUPS, IR_EXEMPT_STOCKS, DARF_MIN, EPS } from './config.js';
import { state, getAsset } from './store.js';
import { buildLedger, allSales, txValue } from './finance.js';
import { money, qtyFmt } from './utils.js';

export const taxYears = () => [...new Set(state.transactions.map(t => t.date.slice(0, 4)))].sort().reverse();

const UNIT_WORDS = { 'Ação': ['ação', 'ações'], 'FII': ['cota', 'cotas'], 'ETF': ['cota', 'cotas'], 'BDR': ['BDR', 'BDRs'] };
const unitWord = (cls, q) => { const w = UNIT_WORDS[cls] || ['unidade', 'unidades']; return Math.abs(q - 1) < 1e-9 ? w[0] : w[1]; };

/** Posição e custo de cada ativo em 31/12 do ano anterior e do ano informado. */
export function bensDireitos(year) {
  const end = `${year}-12-31`, prev = `${year - 1}-12-31`;
  const Le = buildLedger(state.transactions, end), Lp = buildLedger(state.transactions, prev);
  const rows = [];
  for (const a of state.assets) {
    const he = Le[a.ticker], hp = Lp[a.ticker];
    const qe = he?.qty > EPS ? he.qty : 0, qp = hp?.qty > EPS ? hp.qty : 0;
    if (!qe && !qp) continue;
    const ce = qe ? he.cost : 0, cp = qp ? hp.cost : 0;
    const g = IR_GROUPS[a.assetClass] || IR_GROUPS.Outro;
    let text = '';
    if (qe) {
      text = `${qtyFmt(qe)} ${unitWord(a.assetClass, qe)} de ${a.name} (${a.ticker})${a.cnpj ? `, CNPJ ${a.cnpj}` : ''}, custo médio de ${money(ce / qe)}, custo total ${money(ce)}`;
      if (a.currency === 'USD') text += ` (US$ ${qtyFmt(Math.round(he.costCur * 100) / 100)})`;
      if (a.custody) text += `, custodiadas em ${a.custody}`;
      text += '.';
    } else text = `${a.name} (${a.ticker}): posição zerada durante ${year}.`;
    rows.push({ asset: a, qtyPrev: qp, costPrev: cp, qtyEnd: qe, costEnd: ce, group: g, text });
  }
  return rows.sort((x, y) => x.asset.assetClass.localeCompare(y.asset.assetClass) || x.asset.ticker.localeCompare(y.asset.ticker));
}

/** Proventos do ano agrupados por pagador e natureza fiscal. */
export function incomeReport(year) {
  const by = {};
  for (const t of state.transactions) {
    const kind = TX_TYPES[t.type].income;
    if (!kind || !t.date.startsWith(String(year))) continue;
    const k = t.assetTicker || '—';
    const o = by[k] || (by[k] = { ticker: k, asset: getAsset(k), dividendos: 0, rendimentos: 0, jcp: 0, juros: 0 });
    const v = txValue(t);
    if (t.type === 'DIVIDENDO') o.dividendos += v;
    else if (t.type === 'RENDIMENTO') o.rendimentos += v;
    else if (t.type === 'JCP') o.jcp += v;
    else o.juros += v;
  }
  return Object.values(by).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

const bucketOf = cls => cls === 'Ação' ? 'acoes' : (cls === 'ETF' || cls === 'BDR') ? 'comum' : cls === 'FII' ? 'fii' : 'outros';

/**
 * Apuração mensal de renda variável (operações comuns).
 * Ações: ganho isento se vendas do mês ≤ R$ 20 mil (prejuízo sempre compensável).
 * Ações + ETF + BDR: 15%, compensação no mesmo grupo. FII: 20%, compensação própria.
 * O histórico inteiro é percorrido para carregar prejuízos e DARF abaixo do mínimo.
 */
export function monthlyTax(year) {
  const months = {};
  for (const s of allSales()) {
    const m = s.date.slice(0, 7), b = bucketOf(getAsset(s.ticker)?.assetClass);
    const o = months[m] || (months[m] = { month: m, acoesGross: 0, acoes: 0, comum: 0, fii: 0, outros: 0, outrosGross: 0 });
    if (b === 'acoes') { o.acoesGross += s.gross; o.acoes += s.result; }
    else if (b === 'outros') { o.outros += s.result; o.outrosGross += s.gross; }
    else o[b] += s.result;
  }
  let lossComum = 0, lossFii = 0, carry = 0;
  const rows = [];
  for (const m of Object.keys(months).sort()) {
    const o = months[m];
    o.exempt = o.acoesGross > 0 && o.acoesGross <= IR_EXEMPT_STOCKS;
    o.exemptGain = o.exempt ? Math.max(0, o.acoes) : 0;
    let base = (o.exempt ? Math.min(o.acoes, 0) : o.acoes) + o.comum;
    o.lossComumBefore = lossComum;
    if (base < 0) { lossComum += -base; o.taxableComum = 0; }
    else { const use = Math.min(lossComum, base); lossComum -= use; o.taxableComum = base - use; }
    let baseF = o.fii;
    o.lossFiiBefore = lossFii;
    if (baseF < 0) { lossFii += -baseF; o.taxableFii = 0; }
    else { const use = Math.min(lossFii, baseF); lossFii -= use; o.taxableFii = baseF - use; }
    o.tax = o.taxableComum * 0.15 + o.taxableFii * 0.20;
    carry += o.tax;
    o.darf = carry >= DARF_MIN ? carry : 0;
    if (o.darf) carry = 0;
    o.carry = carry; o.lossComum = lossComum; o.lossFii = lossFii;
    rows.push(o);
  }
  return rows.filter(r => r.month.startsWith(String(year)));
}
