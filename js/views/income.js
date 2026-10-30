/* Tela: Proventos — agenda de anunciados, histórico recebido e rendimento por ativo. */
import { TX_TYPES, INCOME_TYPES, ANNOUNCE_TYPES } from '../config.js';
import { state, getAsset, commit, clone } from '../store.js';
import { holding, portfolioTotals, incomeBetween, income12m, pendingAnnouncements, announcementEstimate, sumType } from '../finance.js';
import { barChart, barList } from '../charts.js';
import { $, e, fmt, pct, qtyFmt, dateBR, monthNow, addMonths, monthLabel, today, num, toInput, isDate, str, uid, plural } from '../utils.js';
import { openModal, closeModal, toast } from '../ui.js';
import { showTransactionForm } from '../forms.js';

export function render() {
  const ym = monthNow(), p = portfolioTotals(), inc12 = income12m(), pend = pendingAnnouncements();
  const pendNet = pend.reduce((s, a) => s + announcementEstimate(a).net, 0);
  $('i-12m').textContent = fmt(inc12);
  $('i-12m-sub').textContent = `Média de ${fmt(inc12 / 12)}/mês`;
  $('i-pending').textContent = fmt(pendNet);
  $('i-pending-sub').textContent = pend.length ? `${plural(pend.length, 'provento anunciado', 'proventos anunciados')}` : 'Nenhum anunciado';
  $('i-yoc').textContent = p.cost ? pct(inc12 / p.cost * 100, 2) : '—';
  const y = ym.slice(0, 4), yearInc = sumType(INCOME_TYPES, y);
  $('i-year').textContent = fmt(yearInc);
  $('i-year-sub').textContent = `Em ${y}`;

  const show = $('showReceived').checked;
  const list = [...pend, ...(show ? state.announcements.filter(a => a.status === 'received').sort((a, b) => b.payDate.localeCompare(a.payDate)).slice(0, 30) : [])];
  const t = today();
  $('agendaRows').innerHTML = list.map(a => {
    const est = announcementEstimate(a), asset = getAsset(a.ticker), cur = asset?.currency === 'USD' ? 'USD' : 'BRL', received = a.status === 'received';
    return `<tr>
      <td class="main"><span class="pill ${received ? '' : 'green'}">${e(TX_TYPES[a.type].label)}</span> <b>${e(a.ticker)}</b>${received ? ' <span class="pill">recebido</span>' : a.payDate <= t ? ' <span class="pill yellow">pago — confirmar</span>' : ''}${a.notes ? `<div class="muted small">${e(a.notes)}</div>` : ''}</td>
      <td class="num" data-label="Valor/cota">${fmt(a.perShare, cur)}</td>
      <td class="num" data-label="Data-com">${dateBR(a.dateCom)}</td>
      <td class="num" data-label="Pagamento">${dateBR(a.payDate)}</td>
      <td class="num" data-label="Qtd. na data-com">${qtyFmt(est.qty)}</td>
      <td class="num" data-label="Estimado"><b>${fmt(est.net)}</b>${a.type === 'JCP' ? `<div class="small muted">bruto ${fmt(est.gross)}</div>` : ''}</td>
      <td class="actions-cell">${received ? '' : `<button class="btn sm primary" data-act="confirm-ann" data-id="${e(a.id)}">Confirmar recebimento</button>`}<button class="btn sm" data-act="edit-ann" data-id="${e(a.id)}">Editar</button><button class="btn sm danger" data-act="del-ann" data-id="${e(a.id)}">Excluir</button></td></tr>`;
  }).join('');
  $('agendaEmpty').classList.toggle('hidden', list.length > 0);

  const months = Array.from({ length: 15 }, (_, i) => addMonths(ym, i - 11));
  const pendBy = {};
  pend.forEach(a => { const m = a.payDate.slice(0, 7) < ym ? ym : a.payDate.slice(0, 7); pendBy[m] = (pendBy[m] || 0) + announcementEstimate(a).net; });
  $('i-chart-range').textContent = `${monthLabel(months[0])} a ${monthLabel(months[months.length - 1])}`;
  $('i-chart').innerHTML = barChart(months.map(m => ({ label: monthLabel(m).slice(0, 3), value: m <= ym ? incomeBetween(m, m) : 0, value2: pendBy[m] || 0 })));
  const from = addMonths(ym, -11);
  $('i-types').innerHTML = barList(Object.fromEntries(INCOME_TYPES.map(k => [TX_TYPES[k].label, state.transactions.reduce((s, t) => t.type === k && t.date.slice(0, 7) >= from ? s + num(t.total) * (num(t.fx) || 1) : s, 0)])), inc12);

  const tickers = [...new Set(state.transactions.filter(t => TX_TYPES[t.type].income).map(t => t.assetTicker || '—'))];
  const rows = tickers.map(k => {
    const a = getAsset(k), h = a ? holding(a) : null;
    const total = state.transactions.reduce((s, t) => TX_TYPES[t.type].income && (t.assetTicker || '—') === k ? s + num(t.total) * (num(t.fx) || 1) : s, 0);
    const i12 = k === '—' ? 0 : income12m(k);
    return { k, total, i12, yoc: h?.cost ? i12 / h.cost * 100 : null, dy: h?.market ? i12 / h.market * 100 : null };
  }).sort((a, b) => b.i12 - a.i12 || b.total - a.total);
  $('i-assets').innerHTML = rows.map(r => `<tr><td class="main"><b>${e(r.k === '—' ? 'Sem ativo' : r.k)}</b></td><td class="num" data-label="12 meses">${fmt(r.i12)}</td><td class="num" data-label="Total recebido">${fmt(r.total)}</td><td class="num" data-label="Yield on cost 12m">${r.yoc !== null ? pct(r.yoc, 2) : '—'}</td><td class="num" data-label="Dividend yield 12m">${r.dy !== null ? pct(r.dy, 2) : '—'}</td></tr>`).join('') || '<tr><td class="main muted">Nenhum provento registrado.</td></tr>';
}

function showAnnouncementForm(a = null) {
  const assets = state.assets.filter(x => holding(x).open || x.ticker === a?.ticker);
  if (!assets.length) return toast('Você precisa ter ativos com posição para cadastrar proventos.', true);
  openModal(a ? 'Editar provento anunciado' : 'Provento anunciado', `<form id="annForm"><div class="form-grid">
    <div class="field"><label for="an-t">Ativo *</label><select id="an-t" name="ticker">${assets.map(x => `<option value="${e(x.ticker)}" ${x.ticker === a?.ticker ? 'selected' : ''}>${e(x.ticker)} — ${e(x.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="an-y">Tipo *</label><select id="an-y" name="type">${ANNOUNCE_TYPES.map(k => `<option value="${k}" ${k === (a?.type || 'DIVIDENDO') ? 'selected' : ''}>${e(TX_TYPES[k].label)}</option>`).join('')}</select></div>
    <div class="field"><label for="an-v">Valor bruto por cota *</label><input id="an-v" name="perShare" type="text" inputmode="decimal" required value="${e(toInput(a?.perShare))}" placeholder="Ex.: 0,45"><span class="hint">Valor anunciado no fato relevante, na moeda do ativo.</span></div>
    <div class="field"><label for="an-c">Data-com</label><input id="an-c" name="dateCom" type="date" value="${e(a?.dateCom || '')}"><span class="hint">Quem tem o ativo nesta data recebe.</span></div>
    <div class="field"><label for="an-p">Data de pagamento *</label><input id="an-p" name="payDate" type="date" required value="${e(a?.payDate || '')}"></div>
    <div class="field"><label for="an-n">Observação</label><input id="an-n" name="notes" maxlength="200" value="${e(a?.notes || '')}"></div>
    <div class="field span2"><div class="info-box" id="an-info"></div></div>
  </div><div class="form-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary" type="submit">Salvar</button></div></form>`);
  const f = $('annForm'), el = f.elements;
  const upd = () => {
    const tmp = { ticker: el.ticker.value, type: el.type.value, perShare: num(el.perShare.value), dateCom: el.dateCom.value, payDate: el.payDate.value || today() };
    const est = announcementEstimate(tmp);
    $('an-info').innerHTML = `Posição ${el.dateCom.value ? 'na data-com' : 'atual'}: <b>${qtyFmt(est.qty)}</b> · estimado <b>${fmt(est.net)}</b>${tmp.type === 'JCP' ? ` (líquido de 15% de IR; bruto ${fmt(est.gross)})` : ''}`;
  };
  f.addEventListener('input', upd); f.addEventListener('change', upd); upd();
  f.onsubmit = async ev => {
    ev.preventDefault();
    const perShare = num(el.perShare.value);
    if (!(perShare > 0)) return toast('Informe o valor por cota.', true);
    if (!isDate(el.payDate.value)) return toast('Informe a data de pagamento.', true);
    if (el.dateCom.value && el.dateCom.value > el.payDate.value) return toast('A data-com deve ser antes do pagamento.', true);
    const obj = { id: a?.id || uid(), ticker: el.ticker.value, type: el.type.value, perShare, dateCom: el.dateCom.value, payDate: el.payDate.value, status: a?.status || 'pending', txId: a?.txId || '', notes: str(el.notes.value, 200) };
    const i = state.announcements.findIndex(x => x.id === obj.id);
    if (i >= 0) state.announcements[i] = obj; else state.announcements.push(obj);
    closeModal(); await commit('Provento salvo.');
  };
}

function confirmAnnouncement(id) {
  const a = state.announcements.find(x => x.id === id); if (!a) return;
  const est = announcementEstimate(a);
  showTransactionForm(null, { type: a.type, assetTicker: a.ticker, date: a.payDate <= today() ? a.payDate : today(), total: Math.round(est.net * 100) / 100, notes: `Provento anunciado${a.dateCom ? ` (data-com ${dateBR(a.dateCom)})` : ''}` }, {
    title: 'Confirmar recebimento',
    onSaved: tx => { a.status = 'received'; a.txId = tx.id; }
  });
}

export const actions = {
  'new-announcement': () => showAnnouncementForm(),
  'edit-ann': el => showAnnouncementForm(state.announcements.find(x => x.id === el.dataset.id)),
  'del-ann': async el => {
    const before = clone(state);
    state.announcements = state.announcements.filter(x => x.id !== el.dataset.id);
    await commit('Provento removido da agenda.', { undo: before });
  },
  'confirm-ann': el => confirmAnnouncement(el.dataset.id)
};
export function bind() { $('showReceived').addEventListener('change', render); }
