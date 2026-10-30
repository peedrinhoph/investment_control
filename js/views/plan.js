/* Tela: Metas & aportes — meta mensal, alvos por setor, calculadora, independência financeira e limites. */
import { state, commit, persist } from '../store.js';
import { holding, portfolioTotals, allocation, monthProgress, priceBRL, isAutoRF } from '../finance.js';
import { suggestPlan, fiProjection, concentrationBreaches } from '../planning.js';
import { barChart, lineChart } from '../charts.js';
import { $, e, fmt, money, pct, num, round2, toInput, monthNow, addMonths, monthLabel, qtyFmt, str, uid, today, plural, durationLabel } from '../utils.js';
import { toast } from '../ui.js';

let planAmount = null, lastPlan = null;
export const resetPlanAmount = () => { planAmount = null; };
const focused = id => document.activeElement === $(id);

export function render() {
  const s = state.settings, ym = monthNow();
  if (!focused('goalInput')) $('goalInput').value = toInput(s.monthlyGoal, 2);
  $('goalBasis').value = s.goalBasis;
  const goal = s.monthlyGoal, done = monthProgress(ym);
  $('goalDone').textContent = fmt(done);
  $('goalCaption').textContent = goal ? `de ${fmt(goal)} em ${monthLabel(ym)} · ${pct(Math.min(100, done / goal * 100), 0)}${done < goal ? ` · faltam ${fmt(goal - done)}` : ' · meta atingida'}` : 'Defina um valor de meta.';
  $('goalBar').style.width = Math.min(100, goal ? done / goal * 100 : 0) + '%';
  $('goalChart').innerHTML = barChart(Array.from({ length: 6 }, (_, i) => { const m = addMonths(ym, i - 5); return { label: monthLabel(m), value: monthProgress(m) }; }), goal);
  renderTargets();
  if (planAmount === null) planAmount = Math.max(0, round2(goal - done)) || goal;
  if (!focused('planAmount')) $('planAmount').value = toInput(planAmount, 2);
  renderPlanTable();
  renderFI();
  renderLimits();
}

/* ---------- Alvos ---------- */
function readTargetInputs() {
  const out = {};
  document.querySelectorAll('#targetRows [data-target]').forEach(i => { out[i.dataset.target] = Math.max(0, Math.min(100, num(i.value))); });
  return out;
}
function renderTargets(overrides = null) {
  const t = overrides || state.settings.targets, alloc = allocation('sector'), total = portfolioTotals().market;
  const sectors = [...new Set([...Object.keys(t), ...state.assets.map(a => a.sector || 'Outros')])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $('targetRows').innerHTML = sectors.map(k => {
    const cur = total ? (alloc[k] || 0) / total * 100 : 0, tg = t[k] || 0, diff = cur - tg;
    return `<tr><td class="main"><b>${e(k)}</b></td><td class="num" data-label="Atual">${pct(cur)}</td><td class="num" data-label="Alvo (%)"><input class="cell-input" type="text" inputmode="decimal" data-target="${e(k)}" value="${e(toInput(tg, 2))}" placeholder="0" aria-label="Alvo para ${e(k)}"></td><td class="num" data-label="Diferença">${tg ? `<span class="${Math.abs(diff) >= 5 ? 'warn' : 'positive'}">${diff > 0 ? '+' : ''}${pct(diff)}</span>` : '<span class="muted">—</span>'}</td></tr>`;
  }).join('') || '<tr><td class="main muted">Cadastre ativos para definir alvos por setor.</td></tr>';
  updateTargetSum();
}
function updateTargetSum() {
  const sum = Object.values(readTargetInputs()).reduce((s, v) => s + v, 0);
  $('targetSum').innerHTML = `Soma: <b class="${Math.abs(sum - 100) < 0.01 ? 'positive' : 'warn'}">${pct(sum)}</b>`;
}

/* ---------- Calculadora ---------- */
function renderPlanTable() {
  planAmount = Math.max(0, num($('planAmount').value));
  const res = lastPlan = suggestPlan(planAmount);
  const excluded = new Set(state.settings.planExcluded), byTk = new Map(res.rows.map(r => [r.asset.ticker, r])), targets = state.settings.targets;
  $('planWarnings').innerHTML = res.warnings.map(w => `<div class="notice warning">${e(w)}</div>`).join('');
  const assets = [...state.assets].sort((a, b) => (byTk.get(b.ticker)?.cost || 0) - (byTk.get(a.ticker)?.cost || 0) || a.sector.localeCompare(b.sector) || a.ticker.localeCompare(b.ticker));
  $('planRows').innerHTML = assets.map(a => {
    const r = byTk.get(a.ticker), h = holding(a), price = priceBRL(a);
    const status = excluded.has(a.ticker) ? 'Fora do plano' : !(targets[a.sector] > 0) ? 'Setor sem alvo' : !(price > 0) && !isAutoRF(a) ? 'Sem cotação' : '—';
    return `<tr><td class="main"><label class="check" style="color:var(--text)"><input type="checkbox" data-plan-include="${e(a.ticker)}" ${excluded.has(a.ticker) ? '' : 'checked'}> <b>${e(a.ticker)}</b></label><div class="muted small">${e(a.sector)}</div></td>
      <td class="num" data-label="Posição atual">${fmt(h.market)}</td>
      <td class="num" data-label="Cotação">${price > 0 ? fmt(price) : '—'}</td>
      <td class="num" data-label="Valor sugerido">${r ? fmt(r.ideal) : `<span class="muted small">${status}</span>`}</td>
      <td class="num" data-label="Comprar"><b>${r ? (r.amountOnly ? (r.cost > 0 ? 'valor' : '—') : r.qty > 0 ? qtyFmt(r.qty) : '—') : '—'}</b></td>
      <td class="num" data-label="Custo">${r && r.cost ? fmt(r.cost) : '—'}</td></tr>`;
  }).join('') || '<tr><td class="main muted">Cadastre ativos para usar a calculadora.</td></tr>';
  $('planFoot').innerHTML = planAmount > 0 && res.rows.length ? `<tr><td class="main">Total</td><td></td><td></td><td class="num" data-label="Aporte">${fmt(planAmount)}</td><td class="num" data-label="Sobra"><span class="muted">sobra</span> ${fmt(res.leftover)}</td><td class="num" data-label="Custo total">${fmt(res.spent)}</td></tr>` : '';
  $('registerPlanBtn').disabled = !res.rows.some(r => r.cost > 0);
}

/* ---------- Independência financeira ---------- */
function renderFI() {
  const fi = state.settings.fi;
  if (!focused('fiIncome')) $('fiIncome').value = toInput(fi.monthlyIncome, 2);
  if (!focused('fiRate')) $('fiRate').value = toInput(fi.withdrawalRate, 2);
  if (!focused('fiReturn')) $('fiReturn').value = toInput(fi.realReturn, 2);
  $('fiCash').checked = fi.includeCash;
  if (!(fi.monthlyIncome > 0)) { $('fiResult').innerHTML = '<div class="empty small">Informe a renda mensal desejada para ver o capital necessário e o prazo.</div>'; return; }
  const r = fiProjection();
  const when = r.months === 0 ? 'Meta atingida!' : r.months === null ? 'Não alcançável com os parâmetros atuais' : durationLabel(r.months);
  const year = r.months ? new Date(new Date().getFullYear(), new Date().getMonth() + r.months, 1).getFullYear() : null;
  $('fiResult').innerHTML = `<div class="grid">
    <div class="metric span4"><div class="label">Capital necessário</div><div class="value">${fmt(r.target)}</div><div class="sub">${fmt(fi.monthlyIncome)}/mês ÷ ${pct(fi.withdrawalRate, 1)} a.a.</div></div>
    <div class="metric span4"><div class="label">Patrimônio considerado</div><div class="value">${fmt(r.current)}</div><div class="sub">${pct(r.progress * 100)} da meta</div></div>
    <div class="metric span4"><div class="label">Tempo estimado</div><div class="value">${e(when)}</div><div class="sub">${r.monthlyContribution ? `aportando ${fmt(r.monthlyContribution)}/mês` : 'sem aporte mensal definido'}${year ? ` · ~${year}` : ''}</div></div>
  </div>
  <div class="progress mt"><div style="width:${(r.progress * 100).toFixed(1)}%"></div></div>
  <p class="muted small">Renda sustentável hoje: <b>${fmt(r.sustainableIncome)}/mês</b> · proventos reais (média 12m): <b>${fmt(r.passive12)}/mês</b>.</p>
  ${lineChart(r.points.map(p => ({ label: p.m === 0 ? 'hoje' : `${Math.round(p.m / 12)}a`, value: p.value })), { ref: r.target, empty: '' })}`;
}

/* ---------- Limites de concentração ---------- */
function renderLimits() {
  const l = state.settings.limits;
  if (!focused('limAsset')) $('limAsset').value = toInput(l.asset, 1);
  if (!focused('limSector')) $('limSector').value = toInput(l.sector, 1);
  const br = concentrationBreaches();
  $('limResult').innerHTML = br.length
    ? br.map(b => `<div class="alert warn"><span>${e(b.kind)} <b>${e(b.name)}</b>: ${pct(b.pct)} (limite ${pct(b.limit, 0)})</span></div>`).join('')
    : '<div class="alert ok">Nenhum ativo ou setor acima dos limites.</div>';
}

/* ---------- Ações ---------- */
export const actions = {
  'save-goal': async () => {
    state.settings.monthlyGoal = Math.max(0, round2($('goalInput').value));
    state.settings.goalBasis = $('goalBasis').value === 'APORTE' ? 'APORTE' : 'COMPRA';
    planAmount = null;
    await commit('Meta mensal salva.');
  },
  'add-sector': () => {
    const name = str($('newSector').value, 40);
    if (!name) return toast('Digite o nome do setor.', true);
    const vals = readTargetInputs(); if (!(name in vals)) vals[name] = 0;
    renderTargets(vals); $('newSector').value = '';
    document.querySelector(`#targetRows [data-target="${CSS.escape(name)}"]`)?.focus();
  },
  'save-targets': async () => {
    const vals = readTargetInputs(), sum = Object.values(vals).reduce((s, v) => s + v, 0);
    if (sum > 100.001) return toast(`A soma dos alvos (${pct(sum)}) passa de 100%.`, true);
    state.settings.targets = Object.fromEntries(Object.entries(vals).filter(([, v]) => v > 0));
    await commit(Math.abs(sum - 100) < 0.01 ? 'Alvos salvos.' : `Alvos salvos. A soma está em ${pct(sum)}.`);
  },
  'register-plan': async () => {
    const rows = (lastPlan?.rows || []).filter(r => r.cost > 0);
    if (!rows.length) return toast('Nenhuma compra sugerida.', true);
    const total = rows.reduce((s, r) => s + r.cost, 0);
    const lines = rows.map(r => r.amountOnly ? `${r.asset.ticker}: aplicar ${money(r.cost)}` : `${r.asset.ticker}: ${qtyFmt(r.qty)} × ${money(r.price)}`).join('\n');
    if (!confirm(`Registrar ${plural(rows.length, 'compra', 'compras')} com data de hoje, total ${money(total)}?\n\n${lines}\n\nFaça isso depois de executar as ordens. Ajuste preços, taxas e dólar reais em Movimentações, se necessário.`)) return;
    const d = today(), now = new Date().toISOString();
    rows.forEach(r => {
      const a = r.asset, usd = a.currency === 'USD', fx = usd ? r.price / (num(a.quote) || 1) : 1;
      const qty = r.amountOnly ? 1 : r.qty, unit = r.amountOnly ? r.cost : (usd ? num(a.quote) : r.price);
      state.transactions.push({ id: uid(), date: d, type: 'COMPRA', assetTicker: a.ticker, quantity: qty, unitPrice: unit, total: round2(qty * unit), fee: 0, fx: usd ? round2(fx * 10000) / 10000 : 1, ratio: 0, notes: 'Aporte planejado', createdAt: now });
    });
    planAmount = null;
    await commit('Compras registradas.');
  },
  'save-fi': async () => {
    state.settings.fi = { monthlyIncome: Math.max(0, round2($('fiIncome').value)), withdrawalRate: Math.max(0.1, num($('fiRate').value) || 4), realReturn: num($('fiReturn').value), includeCash: $('fiCash').checked };
    await commit('Meta de independência salva.');
  },
  'save-limits': async () => {
    state.settings.limits = { asset: Math.max(0, Math.min(100, num($('limAsset').value))), sector: Math.max(0, Math.min(100, num($('limSector').value))) };
    await commit('Limites salvos.');
  }
};

export function bind() {
  $('planAmount').addEventListener('input', renderPlanTable);
  $('targetRows').addEventListener('input', updateTargetSum);
  $('newSector').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); actions['add-sector'](); } });
  $('planRows').addEventListener('change', ev => {
    if (!ev.target.matches('[data-plan-include]')) return;
    const tk = ev.target.dataset.planInclude, set = new Set(state.settings.planExcluded);
    if (ev.target.checked) set.delete(tk); else set.add(tk);
    state.settings.planExcluded = [...set];
    persist().catch(() => toast('Falha ao salvar.', true));
    renderPlanTable();
  });
}
