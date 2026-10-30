/* Tela: Carteira. */
import { STALE_DAYS, INDEXERS } from '../config.js';
import { state } from '../store.js';
import { holding, portfolioTotals, isAutoRF, usdRate } from '../finance.js';
import { $, e, fmt, pct, signed, signCls, qtyFmt, dateBR, daysSince } from '../utils.js';
import { options } from '../ui.js';

export function render() {
  const sel = $('assetClassFilter'), curCls = sel.value;
  sel.innerHTML = '<option value="">Todas as classes</option>' + options([...new Set(state.assets.map(a => a.assetClass))].sort(), curCls);
  const q = $('assetSearch').value.trim().toLowerCase(), cls = sel.value, hideZero = $('hideZero').checked;
  const p = portfolioTotals(), lim = state.settings.limits.asset;
  const rows = state.assets.map(a => ({ a, h: holding(a) }))
    .filter(({ a, h }) => (!cls || a.assetClass === cls) && (!hideZero || h.open) && (!q || `${a.ticker} ${a.name} ${a.sector}`.toLowerCase().includes(q)))
    .sort((x, y) => y.h.market - x.h.market || Number(y.h.open) - Number(x.h.open) || x.a.ticker.localeCompare(y.a.ticker));
  $('portfolioRows').innerHTML = rows.map(({ a, h }) => {
    const cur = a.currency, usd = cur === 'USD', auto = isAutoRF(a);
    const stale = h.open && !auto && daysSince(a.quoteDate) > STALE_DAYS;
    const weight = p.market && h.market ? h.market / p.market * 100 : 0;
    const tags = [`<span class="pill">${e(a.assetClass)}</span>`];
    if (usd) tags.push('<span class="pill blue">US$</span>');
    if (a.fixed?.indexer) tags.push(`<span class="pill purple">${e(INDEXERS[a.fixed.indexer].short(a.fixed.rate))}</span>`);
    const quoteCell = auto
      ? `<span title="Valor estimado pela curva do indexador">${h.open ? fmt(h.priceCur) : '—'}</span><div class="small muted">estimado${a.fixed.maturity ? ` · vence ${dateBR(a.fixed.maturity)}` : ''}</div>`
      : `<button class="btn sm" data-act="quote" data-id="${e(a.id)}">${a.quote > 0 ? fmt(a.quote, cur) : 'Informar'}</button><div class="small ${stale ? 'warn' : 'muted'}">${a.quoteDate ? dateBR(a.quoteDate) : 'sem data'}</div>`;
    return `<tr>
      <td class="main"><div class="ticker">${e(a.ticker)} ${tags.join(' ')}</div><div class="muted small">${e(a.name)}</div></td>
      <td data-label="Setor">${e(a.sector)}</td>
      <td class="num" data-label="Quantidade">${qtyFmt(h.qty)}</td>
      <td class="num" data-label="Preço médio">${h.open ? fmt(usd ? h.avgCur : h.avg, cur) : '—'}${h.open && usd ? `<div class="small muted">${fmt(h.avg)}</div>` : ''}</td>
      <td class="num" data-label="Cotação">${quoteCell}</td>
      <td class="num" data-label="Valor">${fmt(h.market)}${h.net !== null && h.open ? `<div class="small muted" title="Após IR regressivo estimado">líq. ${fmt(h.net)}</div>` : ''}${usd && h.open && !(usdRate() > 0) ? '<div class="small warn">sem dólar</div>' : ''}</td>
      <td class="num" data-label="Resultado">${h.open ? `<span class="${signCls(h.unrealized)}">${signed(h.unrealized)}</span><div class="small ${signCls(h.unrealized)}">${h.cost ? pct(h.unrealized / h.cost * 100) : ''}</div>` : '—'}${Math.abs(h.realized) > 0.005 ? `<div class="small muted">realiz. ${signed(h.realized)}</div>` : ''}</td>
      <td class="num" data-label="Proventos">${h.income ? fmt(h.income) : '—'}</td>
      <td class="num" data-label="Peso"><span class="${lim > 0 && weight > lim ? 'warn' : ''}">${weight ? pct(weight) : '—'}</span></td>
      <td class="actions-cell"><button class="btn sm" data-act="new-tx" data-ticker="${e(a.ticker)}">＋ Mov.</button><button class="btn sm" data-act="edit-asset" data-id="${e(a.id)}">Editar</button><button class="btn sm danger" data-act="del-asset" data-id="${e(a.id)}" aria-label="Excluir ${e(a.ticker)}">Excluir</button></td></tr>`;
  }).join('');
  if (rows.length > 1) {
    const t = rows.reduce((o, { h }) => { o.market += h.market; o.unr += h.unrealized; o.cost += h.cost; o.inc += h.income; return o; }, { market: 0, unr: 0, cost: 0, inc: 0 });
    $('portfolioFoot').innerHTML = `<tr><td class="main">Total (${rows.length})</td><td></td><td></td><td></td><td></td><td class="num" data-label="Valor">${fmt(t.market)}</td><td class="num" data-label="Resultado"><span class="${signCls(t.unr)}">${signed(t.unr)}</span><div class="small ${signCls(t.unr)}">${t.cost ? pct(t.unr / t.cost * 100) : ''}</div></td><td class="num" data-label="Proventos">${fmt(t.inc)}</td><td class="num" data-label="Peso">${p.market ? pct(t.market / p.market * 100) : ''}</td><td></td></tr>`;
  } else $('portfolioFoot').innerHTML = '';
  const empty = $('portfolioEmpty');
  empty.classList.toggle('hidden', rows.length > 0);
  empty.innerHTML = state.assets.length ? '<strong>Nenhum ativo encontrado</strong>Ajuste os filtros.' : '<strong>Sua carteira começa aqui</strong>Cadastre um ativo e registre as compras, ou importe o extrato da B3.<div class="form-actions" style="justify-content:center"><button class="btn primary" data-act="new-asset">＋ Cadastrar ativo</button><button class="btn" data-act="import-b3">Importar extrato B3</button></div>';
  const usd = usdRate();
  $('portfolioNote').textContent = `Toque no preço para atualizar a cotação; com mais de ${STALE_DAYS} dias ela fica em amarelo. Resultado = valor de mercado − custo da posição atual; o lucro de vendas aparece como “realiz.”.${state.assets.some(a => a.currency === 'USD') ? ` Dólar usado: ${usd ? fmt(usd) : 'não informado'}.` : ''}`;
}

export function bind() {
  $('assetSearch').addEventListener('input', render);
  $('hideZero').addEventListener('change', render);
  $('assetClassFilter').addEventListener('change', render);
}
