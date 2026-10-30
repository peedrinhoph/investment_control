/* Formulários: movimentação, ativo, cotação, cotações em lote e indicadores. */
import { TX_TYPES, ASSET_CLASSES, WHOLE_UNITS, CURRENCIES, INDEXERS, STALE_DAYS, EPS } from './config.js';
import { state, getAsset, commit, clone, keepBackup } from './store.js';
import { buildLedger, sequenceError, holding, isAutoRF, usdRate, EMPTY_H } from './finance.js';
import { $, e, fmt, num, round, round2, toInput, today, isDate, dateBR, daysSince, str, uid, qtyFmt, signed, signCls, plural, cleanTicker } from './utils.js';
import { openModal, closeModal, toast, options, optionsMap } from './ui.js';

/* ======================= Movimentação ======================= */
/**
 * Abre o formulário de movimentação.
 * t: movimentação existente (edição) · preset: valores iniciais · opts.onSaved(tx): chamado antes de gravar.
 */
export function showTransactionForm(t = null, preset = {}, opts = {}) {
  const v = { type: 'COMPRA', date: today(), assetTicker: '', quantity: '', unitPrice: '', total: '', fee: 0, fx: 0, ratio: 0, notes: '', ...preset, ...(t || {}) };
  if (!t && v.assetTicker && !v.unitPrice && TX_TYPES[v.type]?.qty && v.type !== 'BONIFICACAO') { const a = getAsset(v.assetTicker); if (a?.quote && !isAutoRF(a)) v.unitPrice = a.quote; }
  const r = num(v.ratio), from = r && r < 1 ? round(1 / r, 6) : 1, to = r ? (r >= 1 ? round(r, 6) : 1) : '';
  const assetOpts = state.assets.map(a => `<option value="${e(a.ticker)}" ${a.ticker === v.assetTicker ? 'selected' : ''}>${e(a.ticker)} — ${e(a.name)}${a.currency === 'USD' ? ' (US$)' : ''}</option>`).join('');
  openModal(opts.title || (t ? 'Editar movimentação' : 'Nova movimentação'), `<form id="txForm" novalidate><div class="form-grid">
    <div class="field"><label for="f-type">Tipo *</label><select id="f-type" name="type">${Object.entries(TX_TYPES).map(([k, c]) => `<option value="${k}" ${k === v.type ? 'selected' : ''}>${e(c.label)}</option>`).join('')}</select></div>
    <div class="field"><label for="f-date">Data *</label><input id="f-date" name="date" type="date" max="${today()}" value="${e(v.date)}" required></div>
    <div class="field span2" id="f-asset"><label for="f-ticker" id="f-asset-label">Ativo</label><select id="f-ticker" name="assetTicker"><option value="">${state.assets.length ? 'Selecione…' : 'Cadastre um ativo primeiro'}</option>${assetOpts}</select></div>
    <div class="field" id="f-qty"><label for="f-q" id="f-q-label">Quantidade *</label><input id="f-q" name="quantity" type="text" inputmode="decimal" autocomplete="off" value="${e(toInput(v.quantity))}" placeholder="Ex.: 10"></div>
    <div class="field" id="f-price"><label for="f-p" id="f-p-label">Preço unitário *</label><input id="f-p" name="unitPrice" type="text" inputmode="decimal" autocomplete="off" value="${e(toInput(v.unitPrice))}" placeholder="Ex.: 39,90"></div>
    <div class="field" id="f-fee"><label for="f-f">Taxas/custos</label><input id="f-f" name="fee" type="text" inputmode="decimal" autocomplete="off" value="${e(toInput(v.fee, 2))}" placeholder="0,00"></div>
    <div class="field" id="f-ratio"><label>Proporção *</label><div style="display:flex;gap:8px;align-items:center"><input name="ratioFrom" type="text" inputmode="decimal" value="${e(toInput(from))}" aria-label="De" style="flex:1"><span class="muted">para</span><input name="ratioTo" type="text" inputmode="decimal" value="${e(toInput(to))}" aria-label="Para" style="flex:1"></div><span class="hint" id="f-ratio-hint"></span></div>
    <div class="field" id="f-fx"><label for="f-x">Dólar na data (R$) *</label><input id="f-x" name="fx" type="text" inputmode="decimal" autocomplete="off" value="${e(toInput(num(v.fx) > 1 ? v.fx : usdRate(), 4))}" placeholder="Ex.: 5,42"><span class="hint">Use a PTAX/câmbio do dia: define o custo em reais.</span></div>
    <div class="field" id="f-total-wrap"><label for="f-t" id="f-total-label">Valor *</label><input id="f-t" name="total" type="text" inputmode="decimal" autocomplete="off" value="${e(toInput(v.total, 2))}"><span class="hint" id="f-total-hint"></span></div>
    <div class="field span2" id="f-info-wrap"><div class="info-box" id="f-info"></div></div>
    <div class="field span2"><label for="f-n">Observação</label><input id="f-n" name="notes" maxlength="300" value="${e(v.notes)}" placeholder="Ex.: aporte mensal, corretagem…"></div>
  </div><div class="form-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary" type="submit">Salvar movimentação</button></div></form>`);
  const form = $('txForm'), el = form.elements;
  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  const ratioVal = () => { const a = num(el.ratioFrom.value), b = num(el.ratioTo.value); return a > 0 && b > 0 ? b / a : 0; };

  const update = () => {
    const type = el.type.value, cfg = TX_TYPES[type], tk = el.assetTicker.value, asset = getAsset(tk);
    const usd = asset?.currency === 'USD', cur = usd ? 'USD' : 'BRL', sym = usd ? 'US$' : 'R$';
    show('f-asset', cfg.asset !== 'none');
    $('f-asset-label').textContent = cfg.asset === 'required' ? 'Ativo *' : 'Ativo (opcional)';
    show('f-qty', !!cfg.qty); show('f-price', !!cfg.qty); show('f-fee', !!cfg.qty && type !== 'BONIFICACAO');
    show('f-ratio', !!cfg.ratio); show('f-total-wrap', !cfg.ratio);
    show('f-fx', usd && !cfg.ratio && cfg.asset !== 'none');
    $('f-q-label').textContent = type === 'BONIFICACAO' ? 'Ações recebidas *' : 'Quantidade *';
    $('f-p-label').textContent = type === 'BONIFICACAO' ? `Custo atribuído por ação (${sym})` : `Preço unitário (${sym}) *`;
    el.total.readOnly = !!cfg.qty;
    $('f-total-label').textContent = cfg.qty ? `Valor bruto (${sym}, calculado)` : `Valor (${sym}) *`;
    $('f-total-hint').textContent = cfg.qty ? (type === 'BONIFICACAO' ? 'Quantidade × custo atribuído (consta no fato relevante).' : 'Quantidade × preço. Taxas são somadas ao custo.') : type === 'JCP' ? 'Informe o valor líquido recebido (após 15% de IR).' : '';
    if (cfg.qty) { const q = num(el.quantity.value), p = num(el.unitPrice.value); el.total.value = q && p ? toInput(round2(q * p), 2) : ''; }
    if (cfg.ratio) $('f-ratio-hint').textContent = type === 'DESDOBRAMENTO' ? 'Ex.: 1 para 2 = cada ação vira duas.' : 'Ex.: 10 para 1 = cada dez ações viram uma.';
    let info = '';
    if (tk && (cfg.qty || cfg.ratio)) {
      const others = state.transactions.filter(x => x.id !== t?.id && x.assetTicker === tk && x.date <= (el.date.value || today()));
      const h = buildLedger(others)[tk] || EMPTY_H, avg = h.qty > EPS ? h.cost / h.qty : 0;
      const q = num(el.quantity.value), p = num(el.unitPrice.value), fee = num(el.fee.value), fx = usd ? num(el.fx.value) || 1 : 1;
      info = `Posição na data: <b>${qtyFmt(h.qty)}</b> · preço médio <b>${h.qty > EPS ? fmt(avg) : '—'}</b>`;
      if (type === 'VENDA' && q && p) {
        const res = (Math.min(q, h.qty) * p - fee) * fx - avg * Math.min(q, h.qty);
        info += `<br>Resultado estimado da venda: <b class="${signCls(res)}">${signed(res)}</b>`;
        if (q > h.qty + EPS) info += '<br><span class="negative">Quantidade maior que a posição disponível.</span>';
      } else if ((type === 'COMPRA' || type === 'BONIFICACAO') && q) {
        const add = (q * p + (type === 'COMPRA' ? fee : 0)) * fx;
        info += `<br>Depois: <b>${qtyFmt(h.qty + q)}</b> · novo preço médio <b>${fmt((h.cost + add) / (h.qty + q))}</b>`;
      } else if (cfg.ratio) {
        const rr = ratioVal();
        if (rr && h.qty > EPS) info += `<br>Depois: <b>${qtyFmt(h.qty * rr)}</b> · novo preço médio <b>${fmt(h.cost / (h.qty * rr))}</b> (custo total mantido)`;
        if ((type === 'DESDOBRAMENTO' && rr && rr < 1) || (type === 'GRUPAMENTO' && rr > 1)) info += '<br><span class="warn">A proporção parece invertida para este tipo.</span>';
      }
    }
    $('f-info').innerHTML = info; show('f-info-wrap', !!info);
  };
  form.addEventListener('input', update);
  form.addEventListener('change', ev => {
    if (ev.target.name === 'assetTicker') {
      const a = getAsset(ev.target.value);
      if (TX_TYPES[el.type.value].qty && el.type.value !== 'BONIFICACAO' && !el.unitPrice.value && a?.quote && !isAutoRF(a)) el.unitPrice.value = toInput(a.quote);
      if (a?.currency === 'USD' && !num(el.fx.value)) el.fx.value = toInput(usdRate(), 4);
    }
    update();
  });
  update();

  form.onsubmit = async ev => {
    ev.preventDefault();
    const type = el.type.value, cfg = TX_TYPES[type], date = el.date.value;
    const ticker = cfg.asset === 'none' ? '' : el.assetTicker.value, asset = getAsset(ticker), usd = asset?.currency === 'USD';
    if (!isDate(date)) return toast('Informe uma data válida.', true);
    if (date > today()) return toast('A data não pode estar no futuro.', true);
    if (cfg.asset === 'required' && !ticker) return toast('Selecione o ativo.', true);
    const tx = { id: t?.id || uid(), date, type, assetTicker: ticker, quantity: 0, unitPrice: 0, total: 0, fee: 0, fx: 1, ratio: 0, notes: str(el.notes.value, 300), createdAt: t?.createdAt || new Date().toISOString() };
    if (usd && !cfg.ratio) { tx.fx = num(el.fx.value); if (!(tx.fx > 0)) return toast('Informe a cotação do dólar na data.', true); }
    if (cfg.qty) {
      tx.quantity = num(el.quantity.value); tx.unitPrice = num(el.unitPrice.value); tx.fee = type === 'BONIFICACAO' ? 0 : Math.max(0, round2(el.fee.value));
      if (!(tx.quantity > 0)) return toast('Informe a quantidade.', true);
      if (type !== 'BONIFICACAO' && !(tx.unitPrice > 0)) return toast('Informe o preço.', true);
      if (WHOLE_UNITS.includes(asset?.assetClass) && !Number.isInteger(tx.quantity) && !confirm(`Quantidade fracionária para ${ticker}. Confirmar?`)) return;
      tx.total = round2(tx.quantity * tx.unitPrice);
    } else if (cfg.ratio) {
      tx.ratio = round(ratioVal(), 8);
      if (!(tx.ratio > 0) || tx.ratio === 1) return toast('Informe uma proporção válida (ex.: 1 para 2).', true);
    } else {
      tx.total = round2(el.total.value);
      if (!(tx.total > 0)) return toast('Informe um valor maior que zero.', true);
    }
    const next = t ? state.transactions.map(x => x.id === t.id ? tx : x) : [...state.transactions, tx];
    const err = sequenceError(next, [...new Set([ticker, t?.assetTicker].filter(Boolean))]);
    if (err) return toast(`A posição de ${err.ticker} ficaria negativa em ${dateBR(err.date)}. Revise quantidades e datas.`, true);
    if (cfg.ratio && !t && !(buildLedger(next.filter(x => x.assetTicker === ticker && x.id !== tx.id), date)[ticker]?.qty > 0)) return toast('Não há posição nessa data para aplicar o evento.', true);
    const before = clone(state);
    state.transactions = next;
    let extra = '';
    if (asset && !isAutoRF(asset)) {
      if ((type === 'COMPRA' || type === 'VENDA') && (!asset.quoteDate || date >= asset.quoteDate)) { asset.quote = tx.unitPrice; asset.quoteDate = date; }
      if (cfg.ratio && !t && asset.quote > 0 && (!asset.quoteDate || asset.quoteDate < date)) { asset.quote = round(asset.quote / tx.ratio, 6); extra = ' A cotação anterior foi ajustada pelo fator.'; }
    }
    opts.onSaved?.(tx);
    closeModal();
    await commit((t ? 'Movimentação atualizada.' : 'Movimentação salva.') + extra, { undo: before });
  };
}

export async function deleteTransaction(id) {
  const t = state.transactions.find(x => x.id === id); if (!t) return;
  const next = state.transactions.filter(x => x.id !== id);
  if (t.assetTicker) { const err = sequenceError(next, [t.assetTicker]); if (err) return toast(`Não é possível excluir: a posição de ${err.ticker} ficaria negativa em ${dateBR(err.date)}. Exclua antes a venda posterior.`, true); }
  const before = clone(state);
  state.transactions = next;
  state.announcements.forEach(a => { if (a.txId === id) { a.status = 'pending'; a.txId = ''; } });
  await commit('Movimentação excluída.', { undo: before });
}

/* ======================= Ativo ======================= */
export function showAssetForm(a = null) {
  const sectors = [...new Set([...state.assets.map(x => x.sector), ...Object.keys(state.settings.targets)])].sort();
  const fx = a?.fixed || {};
  openModal(a ? `Editar ${a.ticker}` : 'Cadastrar ativo', `<form id="assetForm"><div class="form-grid">
    <div class="field"><label for="a-t">Ticker / código *</label><input id="a-t" name="ticker" required maxlength="20" autocapitalize="characters" autocomplete="off" value="${e(a?.ticker || '')}" placeholder="Ex.: ITUB4, CDB-XP-2028">${a ? '<span class="hint">Alterar o código atualiza as movimentações.</span>' : '<span class="hint">Para renda fixa, crie um código curto (ex.: CDB-INTER-27).</span>'}</div>
    <div class="field"><label for="a-n">Nome *</label><input id="a-n" name="name" required maxlength="80" value="${e(a?.name || '')}" placeholder="Nome da empresa/título"></div>
    <div class="field"><label for="a-c">Classe *</label><select id="a-c" name="assetClass">${options(ASSET_CLASSES, a?.assetClass || 'Ação')}</select></div>
    <div class="field"><label for="a-s">Setor / categoria</label><input id="a-s" name="sector" list="sectorList" maxlength="40" value="${e(a?.sector || '')}" placeholder="Ex.: Banco, Renda fixa"><datalist id="sectorList">${sectors.map(s => `<option value="${e(s)}">`).join('')}</datalist></div>
    <div class="field"><label for="a-cur">Moeda</label><select id="a-cur" name="currency">${optionsMap(CURRENCIES, a?.currency || 'BRL')}</select></div>
    <div class="field"><label for="a-cnpj">CNPJ (para o IR)</label><input id="a-cnpj" name="cnpj" maxlength="20" inputmode="numeric" value="${e(a?.cnpj || '')}" placeholder="00.000.000/0000-00"></div>
    <div class="field span2"><label for="a-cus">Corretora / custódia</label><input id="a-cus" name="custody" maxlength="80" value="${e(a?.custody || '')}" placeholder="Ex.: XP Investimentos CCTVM S/A, CNPJ …"></div>
    <fieldset class="span2" id="a-rf"><legend>Renda fixa</legend><div class="form-grid">
      <div class="field"><label for="a-ix">Indexador</label><select id="a-ix" name="indexer"><option value="">Sem curva (cotação manual)</option>${Object.entries(INDEXERS).map(([k, x]) => `<option value="${k}" ${k === fx.indexer ? 'selected' : ''}>${e(x.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="a-rate" id="a-rate-label">Taxa</label><input id="a-rate" name="rate" type="text" inputmode="decimal" value="${e(toInput(fx.rate, 4))}" placeholder="Ex.: 110"></div>
      <div class="field"><label for="a-mat">Vencimento</label><input id="a-mat" name="maturity" type="date" value="${e(fx.maturity || '')}"></div>
      <div class="field" style="justify-content:flex-end"><label class="check"><input type="checkbox" name="taxExempt" ${fx.taxExempt ? 'checked' : ''}> Isento de IR (LCI, LCA, CRI, CRA, incentivada)</label></div>
    </div><p class="hint" style="margin:8px 0 0">Com indexador, o valor é estimado pela curva a partir de cada aplicação (quantidade 1 e preço = valor aplicado). Tesouro Direto é marcado a mercado e pode variar da estimativa.</p></fieldset>
    <div class="field" id="a-q-wrap"><label for="a-q" id="a-q-label">Cotação atual</label><input id="a-q" name="quote" type="text" inputmode="decimal" value="${e(toInput(a?.quote))}" placeholder="Preço atual"></div>
    <div class="field" id="a-d-wrap"><label for="a-d">Data da cotação</label><input id="a-d" name="quoteDate" type="date" max="${today()}" value="${e(a?.quoteDate || '')}"></div>
    <div class="field span2"><label for="a-o">Observação</label><textarea id="a-o" name="notes" maxlength="500">${e(a?.notes || '')}</textarea></div>
  </div><div class="form-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary" type="submit">Salvar ativo</button></div></form>`);
  const f = $('assetForm'), el = f.elements;
  const update = () => {
    const rf = el.assetClass.value === 'Renda fixa', ix = el.indexer.value;
    $('a-rf').classList.toggle('hidden', !rf);
    $('a-rate-label').textContent = ix ? INDEXERS[ix].rateLabel : 'Taxa';
    const auto = rf && !!ix;
    $('a-q-wrap').classList.toggle('hidden', auto); $('a-d-wrap').classList.toggle('hidden', auto);
    $('a-q-label').textContent = `Cotação atual (${el.currency.value === 'USD' ? 'US$' : 'R$'})`;
  };
  el.assetClass.addEventListener('change', () => { if (el.assetClass.value === 'Exterior' && !a) el.currency.value = 'USD'; update(); });
  f.addEventListener('change', update); update();
  f.onsubmit = async ev => {
    ev.preventDefault();
    const ticker = cleanTicker(el.ticker.value);
    if (!ticker) return toast('Código inválido: use letras, números, ponto ou hífen (até 20).', true);
    if (state.assets.some(x => x.ticker === ticker && x.id !== a?.id)) return toast('Esse código já está cadastrado.', true);
    const name = str(el.name.value, 80); if (!name) return toast('Informe o nome.', true);
    const assetClass = el.assetClass.value, rf = assetClass === 'Renda fixa', ix = rf ? el.indexer.value : '';
    if (a && a.currency !== el.currency.value && state.transactions.some(t => t.assetTicker === a.ticker) && !confirm('Mudar a moeda de um ativo com movimentações altera a forma de calcular o custo. Continuar?')) return;
    const quote = Math.max(0, num(el.quote.value));
    const obj = { id: a?.id || uid(), ticker, name, assetClass, sector: str(el.sector.value, 40) || (rf ? 'Renda fixa' : 'Outros'), currency: el.currency.value === 'USD' ? 'USD' : 'BRL',
      quote: ix ? 0 : quote, quoteDate: ix ? '' : (isDate(el.quoteDate.value) ? el.quoteDate.value : (quote && quote !== a?.quote ? today() : (a?.quoteDate || ''))),
      quoteMode: ix ? 'auto' : 'manual', cnpj: str(el.cnpj.value, 20), custody: str(el.custody.value, 80),
      fixed: rf && ix ? { indexer: ix, rate: num(el.rate.value), maturity: isDate(el.maturity.value) ? el.maturity.value : '', taxExempt: el.taxExempt.checked } : null,
      notes: str(el.notes.value, 500) };
    if (ix && !(obj.fixed.rate > 0) && ix !== 'SELIC') return toast('Informe a taxa do título.', true);
    const before = clone(state);
    if (a && a.ticker !== ticker) {
      state.transactions.forEach(t => { if (t.assetTicker === a.ticker) t.assetTicker = ticker; });
      state.announcements.forEach(x => { if (x.ticker === a.ticker) x.ticker = ticker; });
      state.settings.planExcluded = state.settings.planExcluded.map(t => t === a.ticker ? ticker : t);
    }
    if (a) state.assets = state.assets.map(x => x.id === a.id ? obj : x); else state.assets.push(obj);
    closeModal();
    await commit('Ativo salvo.', { undo: a ? before : null });
  };
}

export async function deleteAsset(id) {
  const a = state.assets.find(x => x.id === id); if (!a) return;
  const n = state.transactions.filter(t => t.assetTicker === a.ticker).length;
  if (!confirm(n ? `Excluir ${a.ticker} e ${plural(n, 'movimentação vinculada', 'movimentações vinculadas')}?` : `Excluir ${a.ticker}?`)) return;
  const before = clone(state);
  if (n) keepBackup('exclusao-ativo');
  state.assets = state.assets.filter(x => x.id !== id);
  state.transactions = state.transactions.filter(t => t.assetTicker !== a.ticker);
  state.announcements = state.announcements.filter(x => x.ticker !== a.ticker);
  state.settings.planExcluded = state.settings.planExcluded.filter(t => t !== a.ticker);
  await commit('Ativo excluído.', { undo: before });
}

/* ======================= Cotações ======================= */
export function showQuoteForm(a) {
  if (!a) return;
  const sym = a.currency === 'USD' ? 'US$' : 'R$';
  openModal('Atualizar cotação', `<form id="quoteForm"><p class="muted small" style="margin-top:0">${e(a.ticker)} — ${e(a.name)}</p><div class="form-grid">
    <div class="field"><label for="q-v">Preço atual (${sym})</label><input id="q-v" name="quote" type="text" inputmode="decimal" required value="${e(toInput(a.quote))}"></div>
    <div class="field"><label for="q-d">Data da cotação</label><input id="q-d" name="quoteDate" type="date" max="${today()}" required value="${today()}"></div>
  </div><div class="form-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Salvar cotação</button></div></form>`);
  $('quoteForm').onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.currentTarget.elements, q = num(f.quote.value);
    if (!(q > 0) || !isDate(f.quoteDate.value)) return toast('Informe preço e data válidos.', true);
    a.quote = q; a.quoteDate = f.quoteDate.value;
    closeModal(); await commit('Cotação atualizada.');
  };
}

export function showBulkQuotes() {
  const list = state.assets.filter(a => !isAutoRF(a)).sort((x, y) => Number(holding(y).open) - Number(holding(x).open) || x.ticker.localeCompare(y.ticker));
  if (!list.length) return toast('Nenhum ativo com cotação manual.', true);
  openModal('Atualizar cotações', `<form id="pricesForm"><p class="muted small" style="margin-top:0">Informe as cotações consultadas na corretora. Só os campos alterados terão a data atualizada. Renda fixa com indexador é calculada automaticamente.</p>
    <div class="field" style="max-width:220px;margin-bottom:12px"><label for="bq-d">Data das cotações</label><input id="bq-d" name="__date" type="date" max="${today()}" value="${today()}" required></div>
    <div class="form-grid">${list.map(a => `<div class="field"><label for="bq-${e(a.id)}">${e(a.ticker)}${a.currency === 'USD' ? ' (US$)' : ''} <span class="${daysSince(a.quoteDate) > STALE_DAYS ? 'warn' : ''}">· ${a.quoteDate ? dateBR(a.quoteDate) : 'sem data'}</span></label><input id="bq-${e(a.id)}" data-ticker="${e(a.ticker)}" data-old="${e(toInput(a.quote))}" type="text" inputmode="decimal" value="${e(toInput(a.quote))}" placeholder="Preço atual"></div>`).join('')}</div>
    <div class="form-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Salvar cotações</button></div></form>`);
  $('pricesForm').onsubmit = async ev => {
    ev.preventDefault();
    const date = ev.currentTarget.elements.__date.value;
    if (!isDate(date)) return toast('Informe a data.', true);
    let changed = 0;
    ev.currentTarget.querySelectorAll('[data-ticker]').forEach(i => {
      const a = getAsset(i.dataset.ticker), v = num(i.value);
      if (a && i.value !== '' && v > 0 && (i.value !== i.dataset.old || a.quoteDate !== date)) { a.quote = v; a.quoteDate = date; changed++; }
    });
    closeModal(); await commit(changed ? `${plural(changed, 'cotação atualizada', 'cotações atualizadas')}.` : 'Nada alterado.');
  };
}

/* ======================= Indicadores (CDI, Selic, IPCA, dólar) ======================= */
export function showIndicators(onAuto = null) {
  const R = state.settings.rates, U = state.settings.fx.USD;
  openModal('Indicadores de mercado', `<form id="indForm"><p class="muted small" style="margin-top:0">Usados para estimar a renda fixa e converter ativos em dólar. Informe taxas anuais. ${R.date ? `Indicadores atualizados em ${dateBR(R.date)}.` : ''}</p><div class="form-grid">
    <div class="field"><label for="in-cdi">CDI (% a.a.)</label><input id="in-cdi" name="cdi" type="text" inputmode="decimal" value="${e(toInput(R.cdi, 2))}" placeholder="Ex.: 14,90"></div>
    <div class="field"><label for="in-selic">Selic (% a.a.)</label><input id="in-selic" name="selic" type="text" inputmode="decimal" value="${e(toInput(R.selic, 2))}" placeholder="Ex.: 15,00"></div>
    <div class="field"><label for="in-ipca">IPCA projetado (% a.a.)</label><input id="in-ipca" name="ipca" type="text" inputmode="decimal" value="${e(toInput(R.ipca, 2))}" placeholder="Ex.: 4,50"><span class="hint">Use a inflação esperada para os próximos 12 meses.</span></div>
    <div class="field"><label for="in-usd">Dólar (R$)</label><input id="in-usd" name="usd" type="text" inputmode="decimal" value="${e(toInput(U.rate, 4))}" placeholder="Ex.: 5,40"><span class="hint">${U.date ? `Atualizado em ${dateBR(U.date)}.` : 'Ainda não informado.'}</span></div>
  </div><div class="form-actions">${onAuto ? '<button type="button" class="btn" id="indAuto" style="margin-right:auto">Buscar automaticamente</button>' : ''}<button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Salvar</button></div></form>`);
  if (onAuto) $('indAuto').onclick = onAuto;
  $('indForm').onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.currentTarget.elements, d = today();
    const nr = { cdi: Math.max(0, num(f.cdi.value)), selic: Math.max(0, num(f.selic.value)), ipca: num(f.ipca.value) };
    if (nr.cdi !== R.cdi || nr.selic !== R.selic || nr.ipca !== R.ipca) state.settings.rates = { ...nr, date: d };
    const usd = Math.max(0, num(f.usd.value));
    if (usd !== U.rate) state.settings.fx.USD = { rate: usd, date: usd ? d : '' };
    closeModal(); await commit('Indicadores salvos.');
  };
}
