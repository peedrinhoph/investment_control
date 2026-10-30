/* Planejamento: calculadora de aporte, independência financeira e limites de concentração. */
import { WHOLE_UNITS } from './config.js';
import { state } from './store.js';
import { holding, portfolioTotals, allocation, targetSum, priceBRL, isAutoRF, wealthTotals, income12m } from './finance.js';
import { num, round2 } from './utils.js';

/** Sugere a distribuição de um aporte pelos setores abaixo do alvo e, dentro de cada setor, pelos ativos de menor posição. */
export function suggestPlan(amount) {
  const res = { rows: [], spent: 0, leftover: round2(amount), warnings: [] };
  const targets = state.settings.targets;
  if (amount <= 0) return res;
  if (targetSum() <= 0) { res.warnings.push('Defina a alocação-alvo por setor para receber sugestões.'); return res; }
  const excluded = new Set(state.settings.planExcluded);
  const pool = state.assets.filter(a => !excluded.has(a.ticker) && targets[a.sector] > 0);
  const amountOnly = a => isAutoRF(a) || a.assetClass === 'Renda fixa';
  const noQuote = pool.filter(a => !amountOnly(a) && !(priceBRL(a) > 0));
  if (noQuote.length) res.warnings.push(`Sem cotação ${noQuote.some(a => a.currency === 'USD') ? 'ou dólar ' : ''}(ignorados): ${noQuote.map(a => a.ticker).join(', ')}.`);
  const eligible = pool.filter(a => amountOnly(a) || priceBRL(a) > 0);
  const bySector = {};
  eligible.forEach(a => (bySector[a.sector] || (bySector[a.sector] = [])).push(a));
  const sectors = Object.keys(bySector);
  const orphan = Object.keys(targets).filter(k => !bySector[k]);
  if (orphan.length) res.warnings.push(`Setores com alvo sem ativo elegível: ${orphan.join(', ')}. O valor foi redistribuído.`);
  if (!sectors.length) { res.warnings.push('Nenhum ativo elegível: marque ativos de setores com alvo e informe a cotação.'); return res; }
  const after = portfolioTotals().market + amount, cur = allocation('sector');
  const tSum = sectors.reduce((s, k) => s + targets[k], 0);
  const deficit = {}; let dSum = 0;
  for (const k of sectors) { deficit[k] = Math.max(0, after * targets[k] / tSum - (cur[k] || 0)); dSum += deficit[k]; }
  for (const k of sectors) {
    const alloc = dSum > 0 ? amount * deficit[k] / dSum : amount * targets[k] / tSum;
    const list = bySector[k], vals = list.map(a => holding(a).market);
    const each = (vals.reduce((s, v) => s + v, 0) + alloc) / list.length;
    const d = vals.map(v => Math.max(0, each - v)), ds = d.reduce((s, v) => s + v, 0);
    list.forEach((a, i) => res.rows.push({ asset: a, sector: k, ideal: ds > 0 ? alloc * d[i] / ds : alloc / list.length }));
  }
  for (const r of res.rows) {
    r.amountOnly = amountOnly(r.asset);
    r.price = priceBRL(r.asset);
    if (r.amountOnly) { r.qty = 0; r.cost = Math.floor(r.ideal * 100) / 100; continue; }
    r.whole = WHOLE_UNITS.includes(r.asset.assetClass);
    r.qty = r.whole ? Math.floor(r.ideal / r.price + 1e-9) : Math.floor(r.ideal / r.price * 1e6) / 1e6;
    r.cost = round2(r.qty * r.price);
  }
  let left = round2(amount - res.rows.reduce((s, r) => s + r.cost, 0));
  for (let guard = 0; guard < 5000; guard++) { // usa a sobra comprando mais 1 unidade de quem está mais longe do ideal
    const c = res.rows.filter(r => r.whole && r.price <= left + 1e-9 && r.ideal - r.cost > 0).sort((a, b) => (b.ideal - b.cost) - (a.ideal - a.cost))[0];
    if (!c) break;
    c.qty++; c.cost = round2(c.qty * c.price); left = round2(left - c.price);
  }
  res.spent = round2(res.rows.reduce((s, r) => s + r.cost, 0));
  res.leftover = round2(amount - res.spent);
  return res;
}

/**
 * Independência financeira: capital necessário = renda anual ÷ taxa de retirada.
 * Prazo estimado com aporte mensal = meta mensal e retorno real mensal equivalente.
 */
export function fiProjection() {
  const fi = state.settings.fi, w = wealthTotals();
  const target = fi.monthlyIncome > 0 && fi.withdrawalRate > 0 ? fi.monthlyIncome * 12 / (fi.withdrawalRate / 100) : 0;
  const current = w.investments + (fi.includeCash ? Math.max(0, w.cash) : 0);
  const P = num(state.settings.monthlyGoal), i = Math.pow(1 + num(fi.realReturn) / 100, 1 / 12) - 1;
  let months = null;
  if (target > 0) {
    if (current >= target) months = 0;
    else if (Math.abs(i) > 1e-12) {
      const n = Math.log((target * i + P) / (current * i + P)) / Math.log(1 + i);
      months = Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null;
    } else if (P > 0) months = Math.ceil((target - current) / P);
  }
  const horizon = Math.min(months ?? 360, 600), points = [];
  let v = current;
  for (let m = 0; m <= horizon; m++) { if (m % 12 === 0 || m === horizon) points.push({ m, value: v }); v = v * (1 + i) + P; }
  return { target, current, progress: target ? Math.min(1, current / target) : 0, months, points, monthlyContribution: P,
           sustainableIncome: current * (fi.withdrawalRate / 100) / 12, passive12: income12m() / 12 };
}

/** Ativos e setores acima dos limites de concentração. */
export function concentrationBreaches() {
  const { asset: la, sector: ls } = state.settings.limits, total = portfolioTotals().market, out = [];
  if (!total) return out;
  if (la > 0) state.assets.forEach(a => { const p = holding(a).market / total * 100; if (p > la) out.push({ kind: 'ativo', name: a.ticker, pct: p, limit: la }); });
  if (ls > 0) Object.entries(allocation('sector')).forEach(([k, v]) => { const p = v / total * 100; if (p > ls) out.push({ kind: 'setor', name: k, pct: p, limit: ls }); });
  return out.sort((a, b) => (b.pct - b.limit) - (a.pct - a.limit));
}
