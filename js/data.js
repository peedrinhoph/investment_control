/* Dados: backup (simples ou criptografado), CSV, importação da B3, conferência de posição e configurações. */
import { APP_VERSION, SCHEMA_VERSION, KEEP_BACKUPS, TX_TYPES } from './config.js';
import { state, db, setState, normalizeState, demoState, emptyState, hasData, commit, keepBackup, listBackups, markBackup, persist, clone, getAsset } from './store.js';
import { sortTx, txValue, holding } from './finance.js';
import { prefs, savePrefs, applyTheme } from './prefs.js';
import { encryptJSON, decryptJSON, isEncrypted, cryptoAvailable } from './crypto.js';
import { readTabular, parseB3, planImport } from './b3.js';
import { PROVIDERS, runQuoteUpdate, summarize } from './quotes.js';
import { $, e, fmt, num, round2, today, dateBR, plural, qtyFmt, uid } from './utils.js';
import { openModal, closeModal, toast, askPassword, shareOrDownload, optionsMap } from './ui.js';
import { showIndicators } from './forms.js';
import { resetPlanAmount } from './views/plan.js';

const replaceState = async (s, msg) => { setState(s); resetPlanAmount(); closeModal(); await commit(msg); };

/* ======================= Backup ======================= */
function backupMenu() {
  openModal('Backup', `<p class="muted small" style="margin-top:0">O backup contém todo o seu patrimônio. Protegê-lo com senha impede que alguém leia o arquivo caso ele vaze (e-mail, nuvem, pendrive). <b>Sem a senha não há como recuperar.</b></p>
    <div class="form-actions" style="justify-content:flex-start"><button class="btn primary" data-act="export-enc" ${cryptoAvailable() ? '' : 'disabled title="Disponível apenas em HTTPS"'}>Exportar com senha</button><button class="btn" data-act="export-json">Exportar sem senha</button><button class="btn" data-act="import-json">Importar backup</button></div>
    <p class="muted small">Último backup exportado: <b>${state.settings.lastBackupAt ? dateBR(state.settings.lastBackupAt) : 'nunca'}</b>.</p>`);
}
const backupPayload = () => ({ app: 'Patrimonio PWA', schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), state });
async function exportBackup(encrypted) {
  let content;
  if (encrypted) {
    const pw = await askPassword({ title: 'Senha do backup', text: 'Escolha uma senha forte (mínimo 8 caracteres). Ela será pedida para importar o arquivo.', confirm: true, submitLabel: 'Criptografar e exportar' });
    if (!pw) return;
    toast('Criptografando…');
    markBackup();
    content = JSON.stringify(await encryptJSON(backupPayload(), pw));
  } else { markBackup(); content = JSON.stringify(backupPayload(), null, 2); }
  try { await persist(); } catch (_) {}
  closeModal();
  const ok = await shareOrDownload(`backup-patrimonio-${today()}${encrypted ? '-protegido' : ''}.json`, content, 'application/json');
  await commit(ok ? 'Backup exportado.' : '');
}
function importBackup(file) {
  if (file.size > 30 * 1024 * 1024) return toast('Arquivo grande demais para um backup.', true);
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      let obj = JSON.parse(reader.result);
      if (isEncrypted(obj)) {
        if (!cryptoAvailable()) throw new Error('backup protegido só pode ser aberto em HTTPS.');
        const pw = await askPassword({ title: 'Backup protegido', text: 'Digite a senha usada ao exportar este backup.', submitLabel: 'Abrir' });
        if (!pw) return;
        obj = await decryptJSON(obj, pw);
      }
      const incoming = obj.state || obj;
      if (!Array.isArray(incoming.assets) || !Array.isArray(incoming.transactions)) throw new Error('formato não reconhecido.');
      const { state: s, dropped } = normalizeState(incoming);
      if (!confirm(`Importar ${plural(s.assets.length, 'ativo', 'ativos')}, ${plural(s.transactions.length, 'movimentação', 'movimentações')} e ${plural(s.accounts.length + s.properties.length + s.liabilities.length, 'registro patrimonial', 'registros patrimoniais')}?${dropped ? `\n${plural(dropped, 'registro inválido será ignorado', 'registros inválidos serão ignorados')}.` : ''}\n\nOs dados atuais serão substituídos (uma cópia local é guardada).`)) return;
      if (hasData()) keepBackup('importacao');
      await replaceState(s, 'Backup importado com sucesso.');
    } catch (err) { toast('Não foi possível importar: ' + err.message, true); }
  };
  reader.onerror = () => toast('Falha ao ler o arquivo.', true);
  reader.readAsText(file);
}

/* ======================= CSV ======================= */
const csvText = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
const csvNum = n => num(n).toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 8 });
const csvFile = (name, header, lines) => shareOrDownload(name, '﻿' + [header.join(';'), ...lines].join('\r\n'), 'text/csv;charset=utf-8');
function csvTransactions() {
  if (!state.transactions.length) return toast('Sem movimentações para exportar.', true);
  csvFile(`movimentacoes-${today()}.csv`, ['Data', 'Tipo', 'Ativo', 'Quantidade', 'Preço unitário', 'Fator', 'Dólar', 'Valor (R$)', 'Taxas', 'Observação'],
    sortTx(state.transactions).map(t => { const c = TX_TYPES[t.type]; return [dateBR(t.date), csvText(c.label), csvText(t.assetTicker), c.qty ? csvNum(t.quantity) : '', c.qty ? csvNum(t.unitPrice) : '', c.ratio ? csvNum(t.ratio) : '', t.fx > 1 ? csvNum(t.fx) : '', csvNum(round2(txValue(t))), csvNum(t.fee), csvText(t.notes)].join(';'); }));
}
function csvPortfolio() {
  if (!state.assets.length) return toast('Sem ativos para exportar.', true);
  csvFile(`carteira-${today()}.csv`, ['Ticker', 'Nome', 'Classe', 'Setor', 'Moeda', 'Quantidade', 'Preço médio (R$)', 'Cotação', 'Data cotação', 'Valor de mercado (R$)', 'Custo (R$)', 'Resultado não realizado', 'Resultado realizado', 'Proventos', 'CNPJ'],
    state.assets.map(a => { const h = holding(a); return [csvText(a.ticker), csvText(a.name), csvText(a.assetClass), csvText(a.sector), a.currency, csvNum(h.qty), csvNum(round2(h.avg)), csvNum(h.estimated ? round2(h.priceCur) : a.quote), dateBR(a.quoteDate), csvNum(round2(h.market)), csvNum(round2(h.cost)), csvNum(round2(h.unrealized)), csvNum(round2(h.realized)), csvNum(round2(h.income)), csvText(a.cnpj)].join(';'); }));
}

/* ======================= Importação da B3 ======================= */
function b3Intro() {
  openModal('Importar extrato da B3', `<div class="info-box" style="font-size:13px">
    <p style="margin-top:0"><b>Como obter:</b> acesse a <b>Área do Investidor</b> da B3 (investidor.b3.com.br) → <b>Extratos</b> e baixe em Excel:</p>
    <ul style="margin:0 0 8px;padding-left:18px"><li><b>Negociação</b> — compras e vendas na data do pregão (recomendado para compras/vendas).</li><li><b>Movimentação</b> — proventos, desdobramentos, grupamentos, bonificações e liquidações.</li></ul>
    <p style="margin:0">Pode selecionar os dois arquivos juntos. Movimentações já registradas não são duplicadas, e você revisa tudo antes de confirmar.</p></div>
    <div class="form-actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="b3Pick">Escolher arquivos</button></div>`);
  $('b3Pick').onclick = () => $('b3File').click();
}
async function readB3Files(files) {
  const sheets = [];
  for (const f of files) { try { sheets.push(...await readTabular(f)); } catch (err) { toast(`${f.name}: ${err.message}`, true); } }
  return parseB3(sheets);
}
let b3Pending = null, b3Mode = 'import';
async function onB3Files(files) {
  if (!files.length) return;
  toast('Lendo arquivos…');
  const parsed = await readB3Files(files);
  if (b3Mode === 'reconcile') return showReconcile(parsed);
  if (!parsed.cands.length) return toast(parsed.positions.length ? 'Este é um extrato de posição. Use “Conferir posição B3” em Relatórios.' : 'Nenhuma movimentação reconhecida. Use os extratos de Negociação ou Movimentação da B3.', true);
  b3Pending = parsed;
  showB3Preview();
}
function showB3Preview() {
  const parsed = b3Pending, hasBoth = parsed.kinds.includes('negociação') && parsed.cands.some(c => c.settlement);
  const includeSettlement = $('b3Settle') ? $('b3Settle').checked : !hasBoth;
  const includeNear = $('b3Near') ? $('b3Near').checked : false;
  const plan = planImport(parsed.cands, { includeSettlement, includeNear });
  const byType = {}; plan.txs.forEach(t => { byType[t.type] = (byType[t.type] || 0) + 1; });
  const ignored = Object.entries({ ...parsed.ignored, ...plan.skipped });
  const first = plan.txs[0]?.date, last = plan.txs[plan.txs.length - 1]?.date;
  openModal('Revisar importação', `<p class="muted small" style="margin-top:0">Arquivos: ${e(parsed.kinds.join(' + '))}${first ? ` · período ${dateBR(first)} a ${dateBR(last)}` : ''}</p>
    <div class="grid"><div class="card metric span4"><div class="label">Novas movimentações</div><div class="value positive">${plan.txs.length}</div></div><div class="card metric span4"><div class="label">Já registradas</div><div class="value">${plan.dup.length}</div></div><div class="card metric span4"><div class="label">Possíveis duplicatas</div><div class="value ${plan.near.length ? 'warn' : ''}">${plan.near.length}</div></div></div>
    <div class="mt">${Object.entries(byType).map(([k, n]) => `<span class="pill ${TX_TYPES[k].pill}" style="margin:0 6px 6px 0">${e(TX_TYPES[k].label)}: ${n}</span>`).join('') || '<span class="muted small">Nada novo para importar.</span>'}</div>
    ${plan.newAssets.length ? `<h3 class="mt">Ativos que serão cadastrados (${plan.newAssets.length})</h3><p class="muted small" style="margin-top:0">Classe estimada pelo código; ajuste depois em Carteira → Editar (inclua setor e CNPJ).</p><div class="table-wrap"><table class="rt"><thead><tr><th>Código</th><th>Nome</th><th>Classe</th></tr></thead><tbody>${plan.newAssets.map(a => `<tr><td class="main"><b>${e(a.ticker)}</b></td><td data-label="Nome">${e(a.name)}</td><td data-label="Classe">${e(a.assetClass)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${plan.warnings.length ? `<h3 class="mt">Atenção</h3>${plan.warnings.map(w => `<div class="notice warning">${e(w)}</div>`).join('')}` : ''}
    ${ignored.length ? `<details class="mt"><summary class="small muted">Linhas não importadas (${ignored.reduce((s, [, n]) => s + n, 0)})</summary><ul class="small muted">${ignored.map(([k, n]) => `<li>${e(k)}: ${n}</li>`).join('')}</ul><p class="small muted">Transferências entre corretoras, empréstimos, subscrições, leilões de fração e atualizações cadastrais não alteram o custo e não são importados. Registre manualmente se necessário.</p></details>` : ''}
    <div class="divider"></div>
    <label class="check"><input type="checkbox" id="b3Settle" ${includeSettlement ? 'checked' : ''}> Importar compras/vendas do extrato de Movimentação (data de liquidação)${hasBoth ? ' — <b>desmarque se já importou o de Negociação</b>' : ''}</label><br>
    <label class="check mt"><input type="checkbox" id="b3Near" ${includeNear ? 'checked' : ''}> Incluir possíveis duplicatas (mesmo ativo, quantidade e preço com até 5 dias de diferença)</label>
    <div class="form-actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="b3Confirm" ${plan.txs.length ? '' : 'disabled'}>Importar ${plural(plan.txs.length, 'movimentação', 'movimentações')}</button></div>`, { wide: true });
  $('b3Settle').onchange = showB3Preview; $('b3Near').onchange = showB3Preview;
  $('b3Confirm').onclick = async () => {
    const before = clone(state);
    keepBackup('importacao-b3');
    for (const a of plan.newAssets) state.assets.push({ id: uid(), ticker: a.ticker, name: a.name, assetClass: a.assetClass, sector: a.assetClass === 'Renda fixa' ? 'Renda fixa' : 'Outros', currency: 'BRL', quote: 0, quoteDate: '', quoteMode: 'manual', cnpj: '', custody: '', fixed: null, notes: 'Cadastrado pela importação da B3' });
    state.transactions.push(...plan.txs);
    for (const t of plan.txs) {
      const a = getAsset(t.assetTicker);
      if (a && (t.type === 'COMPRA' || t.type === 'VENDA') && (!a.quoteDate || t.date >= a.quoteDate)) { a.quote = t.unitPrice; a.quoteDate = t.date; }
    }
    b3Pending = null; closeModal();
    await commit(`${plural(plan.txs.length, 'movimentação importada', 'movimentações importadas')}.`, { undo: before });
  };
}

/* ======================= Conferência de posição ======================= */
function reconcileIntro() {
  openModal('Conferir posição com a B3', `<div class="info-box" style="font-size:13px"><p style="margin:0">Baixe o extrato de <b>Posição</b> na Área do Investidor da B3 (Excel) e selecione o arquivo. O app compara as quantidades e pode usar o <b>preço de fechamento</b> como cotação.</p></div>
    <div class="form-actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="recPick">Escolher arquivo</button></div>`);
  $('recPick').onclick = () => { b3Mode = 'reconcile'; $('b3File').click(); };
}
function showReconcile(parsed) {
  b3Mode = 'import';
  const pos = parsed.positions;
  if (!pos.length) return toast('Nenhuma posição encontrada. Use o extrato de Posição da B3.', true);
  const map = new Map(); pos.forEach(p => { const o = map.get(p.ticker) || { ...p, qty: 0 }; o.qty += p.qty; if (p.close) o.close = p.close; map.set(p.ticker, o); });
  const tickers = new Set([...map.keys(), ...state.assets.filter(a => holding(a).open && a.assetClass !== 'Caixa').map(a => a.ticker)]);
  const rows = [...tickers].sort().map(tk => { const b = map.get(tk), a = getAsset(tk), app = a ? holding(a).qty : 0; return { tk, b3: b?.qty || 0, app, close: b?.close || 0, diff: (b?.qty || 0) - app, known: !!a }; });
  const bad = rows.filter(r => Math.abs(r.diff) > 1e-6);
  openModal('Conferência de posição', `<p class="muted small" style="margin-top:0">${bad.length ? `<span class="warn">${plural(bad.length, 'divergência encontrada', 'divergências encontradas')}.</span> Diferenças costumam vir de compras antigas não registradas, eventos corporativos ou transferências.` : '<span class="positive">Todas as quantidades conferem.</span>'}</p>
    <div class="table-wrap"><table class="rt"><thead><tr><th>Ativo</th><th class="num">B3</th><th class="num">App</th><th class="num">Diferença</th><th class="num">Fechamento</th></tr></thead><tbody>${rows.map(r => `<tr><td class="main"><b>${e(r.tk)}</b>${r.known ? '' : ' <span class="pill yellow">não cadastrado</span>'}</td><td class="num" data-label="B3">${qtyFmt(r.b3)}</td><td class="num" data-label="App">${qtyFmt(r.app)}</td><td class="num ${Math.abs(r.diff) > 1e-6 ? 'warn' : 'positive'}" data-label="Diferença">${Math.abs(r.diff) > 1e-6 ? (r.diff > 0 ? '+' : '') + qtyFmt(r.diff) : 'ok'}</td><td class="num" data-label="Fechamento">${r.close ? fmt(r.close) : '—'}</td></tr>`).join('')}</tbody></table></div>
    <div class="form-actions"><div class="field" style="margin-right:auto"><label for="recDate">Data do extrato</label><input id="recDate" type="date" max="${today()}" value="${today()}"></div><button class="btn" data-close>Fechar</button><button class="btn primary" id="recQuotes" ${rows.some(r => r.close && r.known) ? '' : 'disabled'}>Usar fechamento como cotação</button></div>`, { wide: true });
  $('recQuotes').onclick = async () => {
    const d = $('recDate').value || today(); let n = 0;
    rows.forEach(r => { const a = getAsset(r.tk); if (a && r.close > 0 && a.currency === 'BRL') { a.quote = r.close; a.quoteDate = d; n++; } });
    closeModal(); await commit(`${plural(n, 'cotação atualizada', 'cotações atualizadas')}.`);
  };
}

/* ======================= Configurações ======================= */
function showSettings() {
  const backups = listBackups().map(k => { let info = {}; try { info = JSON.parse(localStorage.getItem(k)) || {}; } catch (_) {} return { k, at: info.exportedAt, reason: info.backupReason || '', n: info.state?.transactions?.length ?? '?' }; });
  const q = prefs.quotes, prov = PROVIDERS[q.provider] || PROVIDERS.off;
  openModal('Configurações e dados', `
    <h3>Aparência e privacidade</h3>
    <div class="form-grid"><div class="field"><label for="setTheme">Tema</label><select id="setTheme">${optionsMap({ auto: 'Automático (do sistema)', dark: 'Escuro', light: 'Claro' }, prefs.theme)}</select></div>
    <div class="field" style="justify-content:flex-end"><label class="check"><input type="checkbox" id="setHide" ${prefs.hide ? 'checked' : ''}> Ocultar valores em reais</label></div></div>
    <p class="hint">Preferências deste aparelho; não vão para o backup.</p>
    <div class="divider"></div>
    <h3>Cotações e indicadores automáticos <span class="pill">opcional</span></h3>
    <p class="muted small" style="margin-top:0">Busca preços na internet enviando <b>apenas os códigos</b> dos ativos — nenhum dado da carteira sai do aparelho. Se um serviço falhar, a digitação manual continua funcionando.</p>
    <div class="form-grid">
      <div class="field"><label for="qProv">Cotações da B3</label><select id="qProv">${optionsMap(Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.label])), q.provider)}</select></div>
      <div class="field ${prov.needsToken ? '' : 'hidden'}" id="qTokenWrap"><label for="qToken">Token do provedor</label><input id="qToken" type="password" autocomplete="off" value="${e(q.token)}" placeholder="Cole o token"><span class="hint">${e(prov.tokenHint || '')}</span></div>
      <label class="check"><input type="checkbox" id="qFx" ${q.fx ? 'checked' : ''}> Dólar comercial (AwesomeAPI)</label>
      <label class="check"><input type="checkbox" id="qRates" ${q.rates ? 'checked' : ''}> CDI, Selic e IPCA (Banco Central)</label>
      <label class="check span2"><input type="checkbox" id="qAuto" ${q.auto ? 'checked' : ''}> Atualizar ao abrir o app (a cada 1 hora)</label>
    </div>
    <div class="form-actions" style="justify-content:start">
    <span class="hint">${q.lastRun ? `Última busca: ${new Date(q.lastRun).toLocaleString('pt-BR')}` : 'Nenhuma busca feita ainda.'}</span>
    <span style="display:flex;gap:8px"><button class="btn" data-act="indicators">Indicadores manuais</button><button class="btn primary" id="qRun">Atualizar</button></span></div>
    <div class="divider"></div>
    <h3>Backup e importação</h3>
    <p class="muted small" style="margin-top:0">Último backup exportado: <b>${state.settings.lastBackupAt ? dateBR(state.settings.lastBackupAt) : 'nunca'}</b>.</p>
    <div class="form-actions" style="justify-content:flex-start"><button class="btn primary" data-act="export-enc" ${cryptoAvailable() ? '' : 'disabled'}>Exportar com senha</button><button class="btn" data-act="export-json">Exportar sem senha</button><button class="btn" data-act="import-json">Importar backup</button><button class="btn" data-act="import-b3">Importar extrato B3</button><button class="btn" data-act="csv-tx">CSV movimentações</button><button class="btn" data-act="csv-portfolio">CSV carteira</button></div>
    <div class="divider"></div>
    <h3>Cópias automáticas locais</h3>
    <p class="muted small" style="margin-top:0">Criadas antes de migrações, importações e exclusões (mantidas as ${KEEP_BACKUPS} mais recentes, neste navegador).</p>
    ${backups.length ? backups.map(b => `<div class="list-row"><div>${b.at ? e(new Date(b.at).toLocaleString('pt-BR')) : '—'}<div class="muted small">${e(b.reason)} · ${e(b.n)} movimentações</div></div><button class="btn sm" data-act="restore-backup" data-key="${e(b.k)}">Restaurar</button></div>`).join('') : '<p class="muted small">Nenhuma cópia local.</p>'}
    <div class="divider"></div>
    <h3>Armazenamento</h3>
    <p class="muted small" id="storageInfo">${db ? 'LocalStorage + IndexedDB ativos.' : 'IndexedDB indisponível; usando apenas LocalStorage.'} Os dados não são enviados a nenhum servidor.</p>
    <button class="btn sm" data-act="persist-storage" id="persistBtn">Pedir armazenamento persistente</button>
    <div class="divider"></div>
    <h3>Dados</h3>
    <div class="form-actions" style="justify-content:flex-start"><button class="btn" data-act="load-demo">Carregar carteira de exemplo</button><button class="btn danger" data-act="wipe-all">Apagar todos os dados</button></div>
    <p class="hint mt">Versão ${APP_VERSION} · dados v${SCHEMA_VERSION}</p>`);
  $('setTheme').onchange = ev => { prefs.theme = ev.target.value; savePrefs(); applyTheme(); };
  $('setHide').onchange = ev => { prefs.hide = ev.target.checked; savePrefs(); window.dispatchEvent(new Event('patrimonio:render')); };
  $('qProv').onchange = ev => { const p = PROVIDERS[ev.target.value]; $('qTokenWrap').classList.toggle('hidden', !p?.needsToken); };
  $('qRun').onclick = async () => {
    Object.assign(prefs.quotes, { provider: $('qProv').value, token: $('qToken').value.trim(), fx: $('qFx').checked, rates: $('qRates').checked, auto: $('qAuto').checked });
    savePrefs();
    const btn = $('qRun'); btn.disabled = true; btn.textContent = 'Buscando…';
    const r = await runQuoteUpdate();
    closeModal(); await commit(''); toast(summarize(r), !!(r.failed.length || r.errors.length) && !(r.updated || r.fx || r.rates));
  };
  if (navigator.storage?.estimate) navigator.storage.estimate().then(est => { const i = $('storageInfo'); if (i) i.textContent += ` Uso estimado: ${(est.usage / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB.`; }).catch(() => {});
  if (navigator.storage?.persisted) navigator.storage.persisted().then(p => { const b = $('persistBtn'); if (p && b) { b.disabled = true; b.textContent = 'Armazenamento persistente ativo'; } }).catch(() => {});
}
async function restoreBackup(key) {
  let obj; try { obj = JSON.parse(localStorage.getItem(key)); } catch (_) {}
  if (!obj?.state) return toast('Cópia não encontrada.', true);
  if (!confirm('Restaurar esta cópia? Os dados atuais serão substituídos (e guardados como nova cópia).')) return;
  keepBackup('restauracao');
  await replaceState(normalizeState(obj.state).state, 'Cópia restaurada.');
}

async function autoIndicators() {
  if (!prefs.quotes.fx && !prefs.quotes.rates) { prefs.quotes.fx = true; prefs.quotes.rates = true; savePrefs(); }
  toast('Buscando indicadores…');
  const r = await runQuoteUpdate();
  closeModal(); await commit(''); toast(summarize(r), !(r.updated || r.fx || r.rates));
}

export const actions = {
  'backup-menu': () => backupMenu(),
  'export-json': () => exportBackup(false),
  'export-enc': () => exportBackup(true),
  'import-json': () => { closeModal(); $('importFile').click(); },
  'csv-tx': () => csvTransactions(),
  'csv-portfolio': () => csvPortfolio(),
  'import-b3': () => { b3Mode = 'import'; b3Intro(); },
  'reconcile-b3': () => reconcileIntro(),
  'settings': () => showSettings(),
  'indicators': () => showIndicators(autoIndicators),
  'restore-backup': el => restoreBackup(el.dataset.key),
  'persist-storage': async el => {
    if (!navigator.storage?.persist) return toast('Recurso não suportado neste navegador.', true);
    const ok = await navigator.storage.persist();
    toast(ok ? 'Armazenamento persistente concedido.' : 'O navegador não concedeu agora. Instalar o app costuma ajudar.', !ok);
    if (ok) { el.disabled = true; el.textContent = 'Armazenamento persistente ativo'; }
  },
  'load-demo': async () => {
    if (hasData() && !confirm('Carregar a carteira de exemplo substitui os dados atuais (uma cópia local é guardada). Continuar?')) return;
    if (hasData()) keepBackup('exemplo');
    await replaceState(demoState(), 'Carteira de exemplo carregada.');
  },
  'wipe-all': async () => {
    if (!confirm('Apagar TODOS os dados deste navegador? Exporte um backup antes. Uma cópia local temporária será guardada.')) return;
    keepBackup('apagar-tudo');
    await replaceState(emptyState(), 'Dados apagados.');
  }
};

export function bind() {
  $('importFile').addEventListener('change', ev => { const f = ev.target.files[0]; if (f) importBackup(f); ev.target.value = ''; });
  $('b3File').addEventListener('change', ev => { const files = [...ev.target.files]; ev.target.value = ''; onB3Files(files); });
}
