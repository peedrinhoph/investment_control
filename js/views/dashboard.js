/* Tela: Visão geral. */
import { TX_TYPES, INCOME_TYPES, STALE_DAYS, RF_MATURITY_ALERT_DAYS } from '../config.js';
import { state, hasData } from '../store.js';
import { holding, portfolioTotals, wealthTotals, allocation, sumType, monthProgress, income12m, targetSum, sortTx, txValue, isAutoRF, rfNeedsRates, hasUsdAssets, usdRate, pendingAnnouncements, announcementEstimate } from '../finance.js';
import { concentrationBreaches } from '../planning.js';
import { lineChart, barList } from '../charts.js';
import { $, e, fmt, money, pct, signed, signCls, plural, monthNow, monthLabel, dateBR, daysSince, daysBetween, today, qtyFmt, ratioLabel } from '../utils.js';

export function render() {
  const w = wealthTotals(), p = portfolioTotals(), ym = monthNow(), s = state.settings;
  $('onboarding').innerHTML = hasData() ? '' : `<div class="card empty" style="margin-bottom:12px"><strong>Comece seu controle</strong>Cadastre ativos, importe o extrato da B3 ou um backup — ou carregue um exemplo para conhecer o app.<div class="form-actions" style="justify-content:center"><button class="btn primary" data-act="new-asset">＋ Cadastrar ativo</button><button class="btn" data-act="import-b3">Importar extrato B3</button><button class="btn" data-act="import-json">Importar backup</button><button class="btn ghost" data-act="load-demo">Carregar exemplo</button></div></div>`;
  $('d-net').textContent = fmt(w.net);
  const prevKey = Object.keys(state.history).filter(k => k < ym).sort().pop();
  if (prevKey) {
    const prev = state.history[prevKey].net, diff = w.net - prev;
    $('d-net-var').innerHTML = `<span class="${signCls(diff)}">${diff >= 0 ? '▲' : '▼'} ${fmt(Math.abs(diff))}${prev ? ` (${pct(diff / Math.abs(prev) * 100)})` : ''}</span> <span class="muted">vs. ${e(monthLabel(prevKey))}</span>`;
  } else $('d-net-var').innerHTML = '<span class="muted">A variação mensal aparece a partir do próximo mês.</span>';
  $('d-chips').innerHTML = [['Investimentos', w.investments], ['Contas', w.cash], ['Bens', w.properties], ['Dívidas', w.debt ? -w.debt : 0]]
    .map(([l, v]) => `<div class="chip">${l}<b class="${v < 0 ? 'negative' : ''}">${fmt(v)}</b></div>`).join('');

  $('d-market').textContent = fmt(p.market);
  $('d-market-sub').textContent = `${plural(p.count, 'ativo', 'ativos')} com posição · custo ${fmt(p.cost)}`;
  const income = sumType(INCOME_TYPES), fees = sumType(['TAXA']), total = p.unrealized + p.realized + income - fees;
  $('d-result').textContent = signed(total);
  $('d-result').className = 'value ' + signCls(total);
  $('d-result-sub').innerHTML = `Não realizado <span class="${signCls(p.unrealized)}">${signed(p.unrealized)}${p.cost ? ` (${pct(p.unrealized / p.cost * 100)})` : ''}</span><br>Realizado ${signed(p.realized)} · Proventos ${fmt(income)}${fees ? ` · Taxas −${fmt(fees)}` : ''}`;

  const goal = s.monthlyGoal, done = monthProgress(ym);
  $('d-month-label').textContent = s.goalBasis === 'APORTE' ? 'Aportes externos no mês' : 'Investido no mês';
  $('d-month').textContent = fmt(done);
  $('d-month-bar').style.width = Math.min(100, goal ? done / goal * 100 : 0) + '%';
  $('d-month-sub').textContent = goal ? `${pct(done / goal * 100, 0)} da meta de ${fmt(goal)}` : 'Defina uma meta mensal';

  const inc12 = income12m();
  $('d-income').textContent = fmt(inc12);
  $('d-income-sub').textContent = `Média de ${fmt(inc12 / 12)}/mês${p.cost ? ` · ${pct(inc12 / p.cost * 100, 2)} s/ custo` : ''}`;

  const hist = Object.keys(state.history).sort().slice(-24).map(k => ({ label: monthLabel(k), value: state.history[k].net }));
  $('d-history').innerHTML = lineChart(hist, { empty: 'O gráfico aparece a partir do segundo mês. O app grava automaticamente uma fotografia mensal do seu patrimônio líquido.' });

  $('d-alerts').innerHTML = buildAlerts().map(a => `<div class="alert ${a.cls || ''}"><span>${e(a.text)}</span>${a.btn ? `<button class="btn sm" ${a.act ? `data-act="${a.act}"` : `data-page-link="${a.page}"`}${a.ticker ? ` data-ticker="${e(a.ticker)}" data-type="${e(a.type || '')}"` : ''}>${e(a.btn)}</button>` : ''}</div>`).join('');

  const alloc = allocation('sector'), targets = s.targets, lim = s.limits.sector;
  const keys = [...new Set([...Object.keys(alloc), ...Object.keys(targets)])].sort((a, b) => (alloc[b] || 0) - (alloc[a] || 0) || (targets[b] || 0) - (targets[a] || 0));
  $('d-sectors').innerHTML = keys.length && (p.market || targetSum())
    ? keys.map(k => {
        const cur = p.market ? (alloc[k] || 0) / p.market * 100 : 0, t = targets[k] || 0, off = t ? Math.abs(cur - t) >= 5 : cur > 0, over = lim > 0 && cur > lim;
        return `<div class="bar-row"><span title="${e(k)}">${e(k)}</span><div class="bar-track"><div class="bar-fill ${over ? 'warn' : ''}" style="width:${Math.min(100, cur).toFixed(2)}%"></div>${t ? `<div class="bar-target" style="left:calc(${Math.min(100, t)}% - 1.5px)" title="Alvo ${pct(t, 0)}"></div>` : ''}</div><b class="${off ? 'warn' : ''}">${pct(cur)}${t ? ` <span class="muted">/ ${pct(t, 0)}</span>` : ' <span class="muted">sem alvo</span>'}</b></div>`;
      }).join('')
    : '<div class="empty small">Sem posições ainda.</div>';
  const byAsset = {}; state.assets.forEach(a => { const v = holding(a).market; if (v > 0) byAsset[a.ticker] = v; });
  $('d-assets').innerHTML = barList(byAsset, p.market, { limit: s.limits.asset });
  $('d-classes').innerHTML = barList(allocation('assetClass'), p.market);

  const up = pendingAnnouncements().slice(0, 5);
  $('d-upcoming').innerHTML = up.length
    ? up.map(a => { const est = announcementEstimate(a); return `<div class="list-row"><div><span class="pill green">${e(TX_TYPES[a.type].label)}</span> <b>${e(a.ticker)}</b><div class="muted small">Pagamento ${dateBR(a.payDate)}${a.payDate <= today() ? ' · <span class="warn">confirmar</span>' : ''}</div></div><b class="num">${fmt(est.net)}</b></div>`; }).join('')
    : '<div class="empty small">Nenhum provento anunciado. Cadastre na aba Proventos.</div>';

  const recent = sortTx(state.transactions).reverse().slice(0, 6);
  $('d-recent').innerHTML = recent.length
    ? recent.map(t => { const c = TX_TYPES[t.type]; return `<div class="list-row"><div><span class="pill ${c.pill}">${e(c.label)}</span> <b>${e(t.assetTicker)}</b><div class="muted small">${dateBR(t.date)}${c.qty ? ` · ${qtyFmt(t.quantity)} × ${fmt(t.unitPrice, t.fx > 1 ? 'USD' : 'BRL')}` : c.ratio ? ` · fator ${ratioLabel(t.ratio)}` : ''}</div></div><b class="num">${c.ratio ? '—' : fmt(txValue(t))}</b></div>`; }).join('')
    : '<div class="empty small">Ainda não há movimentações.</div>';
}

function buildAlerts() {
  const out = [], s = state.settings, t = today();
  if (!hasData()) return [{ text: 'Cadastre seus ativos ou importe o extrato da B3 para começar.', act: 'import-b3', btn: 'Importar' }];
  const open = state.assets.filter(a => holding(a).open);
  const due = pendingAnnouncements().filter(a => a.payDate <= t);
  if (due.length) out.push({ cls: 'warn', text: `${plural(due.length, 'provento já pago aguarda', 'proventos já pagos aguardam')} confirmação.`, page: 'income', btn: 'Confirmar' });
  const manual = open.filter(a => !isAutoRF(a));
  const noQ = manual.filter(a => !(a.quote > 0));
  if (noQ.length) out.push({ cls: 'warn', text: `Sem cotação: ${noQ.map(a => a.ticker).join(', ')}.`, act: 'bulk-quotes', btn: 'Informar' });
  const stale = manual.filter(a => a.quote > 0 && daysSince(a.quoteDate) > STALE_DAYS);
  if (stale.length) out.push({ cls: 'warn', text: `${plural(stale.length, 'cotação desatualizada', 'cotações desatualizadas')} (+${STALE_DAYS} dias): ${stale.slice(0, 4).map(a => a.ticker).join(', ')}${stale.length > 4 ? '…' : ''}`, act: 'bulk-quotes', btn: 'Atualizar' });
  if (hasUsdAssets() && !(usdRate() > 0)) out.push({ cls: 'warn', text: 'Informe a cotação do dólar para avaliar ativos no exterior.', act: 'indicators', btn: 'Informar' });
  else if (hasUsdAssets() && daysSince(s.fx.USD.date) > STALE_DAYS) out.push({ cls: 'warn', text: 'Cotação do dólar desatualizada.', act: 'indicators', btn: 'Atualizar' });
  if (rfNeedsRates()) out.push({ cls: 'warn', text: 'Informe CDI/Selic/IPCA para estimar a renda fixa.', act: 'indicators', btn: 'Informar' });
  open.filter(a => a.assetClass === 'Renda fixa' && a.fixed?.maturity).forEach(a => {
    const d = daysBetween(t, a.fixed.maturity);
    if (d <= RF_MATURITY_ALERT_DAYS) out.push({ cls: 'warn', text: d < 0 ? `${a.ticker} venceu em ${dateBR(a.fixed.maturity)}. Registre o resgate.` : `${a.ticker} vence em ${plural(d, 'dia', 'dias')} (${dateBR(a.fixed.maturity)}).`, act: 'new-tx', ticker: a.ticker, type: 'VENDA', btn: 'Resgatar' });
  });
  concentrationBreaches().slice(0, 3).forEach(b => out.push({ cls: 'warn', text: `Concentração: ${b.kind} ${b.name} representa ${pct(b.pct)} da carteira (limite ${pct(b.limit, 0)}).`, page: 'plan', btn: 'Ver limites' }));
  const ts = targetSum();
  if (Object.keys(s.targets).length && Math.abs(ts - 100) > 0.01) out.push({ cls: 'warn', text: `A alocação-alvo soma ${pct(ts, 0)} (ideal: 100%).`, page: 'plan', btn: 'Ajustar' });
  const total = portfolioTotals().market;
  if (ts > 0 && total > 0) {
    const alloc = allocation('sector'); let worst = null;
    for (const [k, v] of Object.entries(s.targets)) { const d = (alloc[k] || 0) / total * 100 - v; if (!worst || Math.abs(d) > Math.abs(worst.d)) worst = { k, d }; }
    if (worst && Math.abs(worst.d) >= 5) out.push({ text: `${worst.k} está ${pct(Math.abs(worst.d))} ${worst.d > 0 ? 'acima' : 'abaixo'} do alvo.`, page: 'plan', btn: 'Ver plano' });
  }
  if (s.monthlyGoal > 0) {
    const done = monthProgress(monthNow());
    out.push(done < s.monthlyGoal ? { text: `Faltam ${money(s.monthlyGoal - done)} para a meta deste mês.`, page: 'plan', btn: 'Calcular aporte' } : { cls: 'ok', text: 'Meta do mês atingida.' });
  }
  if (!out.length) out.push({ cls: 'ok', text: 'Tudo em dia.' });
  return out;
}
