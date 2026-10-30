/* Tela: Movimentações. */
import { TX_TYPES, INCOME_TYPES, TX_PAGE } from '../config.js';
import { state, getAsset } from '../store.js';
import { sortTx, txValue } from '../finance.js';
import { $, e, fmt, qtyFmt, dateBR, plural, ratioLabel, num } from '../utils.js';
import { options } from '../ui.js';

let limit = TX_PAGE;

export function render() {
  const tSel = $('txTypeFilter'), aSel = $('txAssetFilter'), tv = tSel.value, av = aSel.value;
  tSel.innerHTML = '<option value="">Todos os tipos</option>' + Object.entries(TX_TYPES).map(([k, v]) => `<option value="${k}" ${k === tv ? 'selected' : ''}>${e(v.label)}</option>`).join('');
  aSel.innerHTML = '<option value="">Todos os ativos</option>' + options(state.assets.map(a => a.ticker).sort(), av);
  const q = $('txSearch').value.trim().toLowerCase(), type = tSel.value, asset = aSel.value, month = $('txMonth').value;
  const list = sortTx(state.transactions).reverse().filter(t => (!type || t.type === type) && (!asset || t.assetTicker === asset) && (!month || t.date.startsWith(month))
    && (!q || `${t.type} ${TX_TYPES[t.type].label} ${t.assetTicker} ${t.notes}`.toLowerCase().includes(q)));
  const shown = list.slice(0, limit);
  $('txRows').innerHTML = shown.map(t => {
    const cfg = TX_TYPES[t.type], usd = getAsset(t.assetTicker)?.currency === 'USD', cur = usd ? 'USD' : 'BRL';
    return `<tr>
      <td class="main"><span class="pill ${cfg.pill}">${e(cfg.label)}</span> <b>${e(t.assetTicker)}</b><div class="muted small">${dateBR(t.date)}${usd && num(t.fx) > 0 ? ` · dólar ${fmt(t.fx)}` : ''}</div></td>
      <td class="num" data-label="${cfg.ratio ? 'Fator' : 'Quantidade'}">${cfg.qty ? qtyFmt(t.quantity) : cfg.ratio ? ratioLabel(t.ratio) : ''}</td>
      <td class="num" data-label="${t.type === 'BONIFICACAO' ? 'Custo atribuído' : 'Preço'}">${cfg.qty ? fmt(t.unitPrice, cur) : ''}</td>
      <td class="num" data-label="Valor"><b>${cfg.ratio ? '—' : fmt(txValue(t))}</b></td>
      <td class="num" data-label="Taxas">${t.fee ? fmt(t.fee, cur) : ''}</td>
      <td class="two-line wide" data-label="Observação">${t.notes ? e(t.notes) : ''}</td>
      <td class="actions-cell"><button class="btn sm" data-act="dup-tx" data-id="${e(t.id)}" title="Repetir com a data de hoje">Repetir</button><button class="btn sm" data-act="edit-tx" data-id="${e(t.id)}">Editar</button><button class="btn sm danger" data-act="del-tx" data-id="${e(t.id)}">Excluir</button></td></tr>`;
  }).join('');
  $('txEmpty').classList.toggle('hidden', list.length > 0);
  $('txMore').classList.toggle('hidden', list.length <= limit);
  const by = types => list.reduce((s, t) => types.includes(t.type) ? s + txValue(t) : s, 0);
  $('txSummary').textContent = list.length ? `${plural(list.length, 'movimentação', 'movimentações')}${list.length > shown.length ? ` (exibindo ${shown.length})` : ''} · Compras ${fmt(by(['COMPRA']))} · Vendas ${fmt(by(['VENDA']))} · Proventos ${fmt(by(INCOME_TYPES))}` : '';
}

export function bind() {
  ['txSearch', 'txTypeFilter', 'txAssetFilter', 'txMonth'].forEach(id => $(id).addEventListener(id === 'txSearch' ? 'input' : 'change', () => { limit = TX_PAGE; render(); }));
  $('txClear').addEventListener('click', () => { ['txSearch', 'txTypeFilter', 'txAssetFilter', 'txMonth'].forEach(id => { $(id).value = ''; }); limit = TX_PAGE; render(); });
}

export const actions = { 'tx-more': () => { limit += TX_PAGE; render(); } };
