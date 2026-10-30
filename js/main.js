/* Ponto de entrada: monta as telas, liga eventos, navegação, atualização do app e cotações automáticas. */
import { APP_VERSION, PAGES, BACKUP_DAYS, STATE_KEY } from './config.js';
import { state, hasData, initStore, configureStore, reloadFromStorage, getAsset, commit } from './store.js';
import { wealthTotals } from './finance.js';
import { prefs, savePrefs, applyTheme } from './prefs.js';
import { $, e, round2, monthNow, today, daysSince } from './utils.js';
import { toast, closeModal, isModalOpen } from './ui.js';
import { showTransactionForm, deleteTransaction, showAssetForm, deleteAsset, showQuoteForm, showBulkQuotes } from './forms.js';
import { shouldAutoRun, runQuoteUpdate, summarize } from './quotes.js';
import * as dashboard from './views/dashboard.js';
import * as portfolio from './views/portfolio.js';
import * as transactions from './views/transactions.js';
import * as income from './views/income.js';
import * as plan from './views/plan.js';
import * as wealth from './views/wealth.js';
import * as reports from './views/reports.js';
import * as data from './data.js';

const views = [dashboard, portfolio, transactions, income, plan, wealth, reports];
let updateWorker = null;

/* ---------- Render ---------- */
function renderHeader() {
  $('hideBtn').setAttribute('aria-pressed', String(prefs.hide));
  $('hideIco').textContent = prefs.hide ? '◎' : '◉';
  $('hideLabel').textContent = prefs.hide ? 'Mostrar valores' : 'Ocultar valores';
}
function renderBanner() {
  let html = '';
  if (updateWorker) html += `<div class="notice info"><span>Nova versão do app disponível.</span><button class="btn sm primary" data-act="apply-update">Atualizar agora</button></div>`;
  const last = state.settings.lastBackupAt, days = daysSince(last);
  if (hasData() && days > BACKUP_DAYS) html += `<div class="notice warning"><span>${last ? `Último backup há ${days} dias.` : 'Você ainda não exportou nenhum backup.'} Os dados ficam só neste aparelho — limpar os dados do site apaga tudo.</span><button class="btn sm" data-act="backup-menu">Fazer backup</button></div>`;
  $('banner').innerHTML = html;
}
export function render() {
  renderHeader(); renderBanner();
  for (const v of views) { try { v.render(); } catch (err) { console.error(err); } }
}
function snapshot() {
  const w = wealthTotals();
  state.history[monthNow()] = { net: round2(w.net), invested: round2(w.investments), at: today() };
}

/* ---------- Navegação ---------- */
const currentPage = () => { const h = location.hash.slice(1); return PAGES.includes(h) ? h : 'dashboard'; };
function switchPage(name) {
  document.querySelectorAll('.nav button').forEach(b => { const on = b.dataset.page === name; b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  window.scrollTo({ top: 0 });
}
function goto(name) { closeModal(); if (currentPage() === name) switchPage(name); else location.hash = name; }

/* ---------- Ações (cliques em [data-act]) ---------- */
const ACTIONS = {
  'new-tx': el => showTransactionForm(null, { ...(el.dataset.ticker ? { assetTicker: el.dataset.ticker } : {}), ...(el.dataset.type ? { type: el.dataset.type } : {}) }),
  'edit-tx': el => { const t = state.transactions.find(x => x.id === el.dataset.id); if (t) showTransactionForm(t); },
  'dup-tx': el => {
    const t = state.transactions.find(x => x.id === el.dataset.id); if (!t) return;
    const a = getAsset(t.assetTicker);
    showTransactionForm(null, { type: t.type, assetTicker: t.assetTicker, quantity: t.quantity, unitPrice: (t.type === 'COMPRA' || t.type === 'VENDA') && a?.quote ? a.quote : t.unitPrice, total: t.total, fee: t.fee, ratio: t.ratio, notes: t.notes });
  },
  'del-tx': el => deleteTransaction(el.dataset.id),
  'new-asset': () => showAssetForm(),
  'edit-asset': el => showAssetForm(state.assets.find(a => a.id === el.dataset.id)),
  'del-asset': el => deleteAsset(el.dataset.id),
  'quote': el => showQuoteForm(state.assets.find(a => a.id === el.dataset.id)),
  'bulk-quotes': () => showBulkQuotes(),
  'toggle-hide': () => { prefs.hide = !prefs.hide; savePrefs(); render(); const c = $('setHide'); if (c) c.checked = prefs.hide; },
  'apply-update': () => { updateWorker?.postMessage({ type: 'SKIP_WAITING' }); },
  ...transactions.actions, ...income.actions, ...plan.actions, ...wealth.actions, ...reports.actions, ...data.actions
};

function bindEvents() {
  document.addEventListener('click', ev => {
    const nav = ev.target.closest('[data-page],[data-page-link]');
    if (nav) { goto(nav.dataset.page || nav.dataset.pageLink); return; }
    if (ev.target.closest('[data-close]')) { closeModal(); return; }
    const el = ev.target.closest('[data-act]');
    if (el && ACTIONS[el.dataset.act] && !el.disabled) { ev.preventDefault(); ACTIONS[el.dataset.act](el); }
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && isModalOpen()) closeModal(); });
  $('modalBackdrop').addEventListener('click', ev => { if (ev.target === $('modalBackdrop')) closeModal(); });
  window.addEventListener('hashchange', () => { closeModal(); switchPage(currentPage()); });
  window.addEventListener('storage', ev => { if (ev.key === STATE_KEY && ev.newValue && reloadFromStorage(ev.newValue)) { render(); toast('Dados atualizados em outra aba.'); } });
  window.addEventListener('patrimonio:render', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  views.forEach(v => v.bind?.());
  data.bind();
}

/* ---------- Atualização do app (service worker) ---------- */
async function registerSW() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    const offer = w => { updateWorker = w; renderBanner(); };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    setInterval(() => reg.update().catch(() => {}), 3600e3);
  } catch (_) {}
}

/* ---------- Inicialização ---------- */
async function init() {
  applyTheme();
  $('appVersion').textContent = 'v' + APP_VERSION;
  configureStore({ render, snapshot });
  await initStore();
  bindEvents();
  if (hasData() && !state.history[monthNow()]) await commit('');
  switchPage(currentPage());
  render();
  registerSW();
  if (shouldAutoRun()) runQuoteUpdate().then(r => { render(); if (r.updated || r.fx || r.rates || r.failed.length) toast(summarize(r)); }).catch(() => {});
}
init().catch(err => { console.error(err); document.body.insertAdjacentHTML('afterbegin', `<div class="notice warning" style="margin:12px">Falha ao iniciar o app: ${e(err.message)}</div>`); });
