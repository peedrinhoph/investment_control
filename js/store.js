/* Estado do app: modelo, validação, migração e persistência (LocalStorage + IndexedDB). */
import { SCHEMA_VERSION, DB_NAME, DB_VERSION, STORE, STATE_KEY, BACKUP_PREFIX, KEEP_BACKUPS, TX_TYPES, ASSET_CLASSES, CURRENCIES, INDEXERS, WEALTH, ANNOUNCE_TYPES } from './config.js';
import { arr, num, round2, isDate, str, cleanId, cleanTicker, uid, today, plural } from './utils.js';
import { toast } from './ui.js';

export function emptyState() {
  return {
    version: SCHEMA_VERSION, updatedAt: '',
    settings: {
      monthlyGoal: 1000, goalBasis: 'COMPRA', targets: {}, planExcluded: [], lastBackupAt: '',
      limits: { asset: 25, sector: 40 },
      fi: { monthlyIncome: 0, withdrawalRate: 4, realReturn: 5, includeCash: false },
      rates: { cdi: 0, selic: 0, ipca: 0, date: '' },
      fx: { USD: { rate: 0, date: '' } }
    },
    assets: [], transactions: [], announcements: [], accounts: [], properties: [], liabilities: [], history: {}
  };
}

export function demoState() {
  const s = emptyState(), now = new Date().toISOString();
  s.settings.targets = { 'Banco': 40, 'Energia elétrica': 20, 'Saneamento': 20, 'Seguros': 20 };
  const A = (ticker, name, sector, quote, notes = '') => ({ id: uid(), ticker, name, assetClass: 'Ação', sector, currency: 'BRL', quote, quoteDate: '2026-10-28', quoteMode: 'manual', cnpj: '', custody: '', fixed: null, notes });
  s.assets = [
    A('ITUB4', 'Itaú Unibanco PN', 'Banco', 39.78), A('LWSA3', 'LWSA ON', 'Tecnologia', 12.76, 'Fora da carteira-alvo'),
    A('BBAS3', 'Banco do Brasil ON', 'Banco', 16.79), A('CPFE3', 'CPFL Energia ON', 'Energia elétrica', 42.95),
    A('SBSP3', 'Sabesp ON', 'Saneamento', 25.11), A('BBSE3', 'BB Seguridade ON', 'Seguros', 41.35)
  ];
  const T = (ticker, quantity, unitPrice) => ({ id: uid(), date: '2026-10-29', type: 'COMPRA', assetTicker: ticker, quantity, unitPrice, total: round2(quantity * unitPrice), fee: 0, fx: 1, ratio: 0, notes: 'Posição inicial (exemplo)', createdAt: now });
  s.transactions = [T('ITUB4', 7, 39.82), T('LWSA3', 268, 12.76)];
  return s;
}

/** Valida e normaliza qualquer estado vindo do armazenamento ou de um backup (inclui migração de versões antigas). */
export function normalizeState(raw) {
  const s = emptyState();
  let dropped = 0;
  if (!raw || typeof raw !== 'object') return { state: s, dropped };
  const rs = (raw.settings && typeof raw.settings === 'object') ? raw.settings : {};
  const st = s.settings;
  st.monthlyGoal = Math.max(0, round2(rs.monthlyGoal ?? 1000));
  st.goalBasis = rs.goalBasis === 'APORTE' ? 'APORTE' : 'COMPRA';
  const lb = String(rs.lastBackupAt || '').slice(0, 10); st.lastBackupAt = isDate(lb) ? lb : '';
  if (rs.targets && typeof rs.targets === 'object') for (const [k, v] of Object.entries(rs.targets)) { const key = str(k, 40), val = Math.max(0, Math.min(100, num(v))); if (key && val > 0) st.targets[key] = val; }
  if (rs.limits) { st.limits.asset = Math.max(0, Math.min(100, num(rs.limits.asset ?? 25))); st.limits.sector = Math.max(0, Math.min(100, num(rs.limits.sector ?? 40))); }
  if (rs.fi) st.fi = { monthlyIncome: Math.max(0, round2(rs.fi.monthlyIncome)), withdrawalRate: Math.max(0, num(rs.fi.withdrawalRate ?? 4)), realReturn: num(rs.fi.realReturn ?? 5), includeCash: !!rs.fi.includeCash };
  if (rs.rates) st.rates = { cdi: Math.max(0, num(rs.rates.cdi)), selic: Math.max(0, num(rs.rates.selic)), ipca: num(rs.rates.ipca), date: isDate(rs.rates.date) ? rs.rates.date : '' };
  if (rs.fx?.USD) st.fx.USD = { rate: Math.max(0, num(rs.fx.USD.rate)), date: isDate(rs.fx.USD.date) ? rs.fx.USD.date : '' };

  const tickers = new Set(), ids = new Set(), currencyOf = {};
  const freshId = v => { let id = cleanId(v); while (ids.has(id)) id = uid(); ids.add(id); return id; };
  for (const a of arr(raw.assets)) {
    const ticker = cleanTicker(a?.ticker);
    if (!ticker || tickers.has(ticker)) { dropped++; continue; }
    tickers.add(ticker);
    const assetClass = ASSET_CLASSES.includes(a.assetClass) ? a.assetClass : 'Outro';
    const currency = CURRENCIES[a.currency] ? a.currency : 'BRL';
    currencyOf[ticker] = currency;
    let fixed = null;
    if (assetClass === 'Renda fixa' && a.fixed && INDEXERS[a.fixed.indexer]) {
      fixed = { indexer: a.fixed.indexer, rate: num(a.fixed.rate), maturity: isDate(a.fixed.maturity) ? a.fixed.maturity : '', taxExempt: !!a.fixed.taxExempt };
    }
    s.assets.push({ id: freshId(a.id), ticker, name: str(a.name, 80) || ticker, assetClass, sector: str(a.sector, 40) || 'Outros', currency,
      quote: Math.max(0, num(a.quote)), quoteDate: isDate(a.quoteDate) ? a.quoteDate : '', quoteMode: a.quoteMode === 'auto' ? 'auto' : 'manual',
      cnpj: str(a.cnpj, 20), custody: str(a.custody, 80), fixed, notes: str(a.notes, 500) });
  }
  if (Array.isArray(rs.planExcluded)) st.planExcluded = [...new Set(rs.planExcluded.map(cleanTicker).filter(t => tickers.has(t)))];
  else if (Array.isArray(rs.assetContributionIncluded)) { const inc = new Set(rs.assetContributionIncluded.map(cleanTicker)); st.planExcluded = [...tickers].filter(t => !inc.has(t)); }

  for (const t of arr(raw.transactions)) {
    const type = TX_TYPES[t?.type] ? t.type : null;
    if (!type || !isDate(t.date)) { dropped++; continue; }
    const cfg = TX_TYPES[type];
    let ticker = t.assetTicker ? cleanTicker(t.assetTicker) : '';
    if (cfg.asset === 'required' && !tickers.has(ticker)) { dropped++; continue; }
    if (cfg.asset === 'none' || !tickers.has(ticker)) ticker = '';
    const quantity = cfg.qty ? Math.max(0, num(t.quantity)) : 0;
    const unitPrice = cfg.qty ? Math.max(0, num(t.unitPrice)) : 0;
    const ratio = cfg.ratio ? num(t.ratio) : 0;
    if (cfg.qty && (quantity <= 0 || (type !== 'BONIFICACAO' && unitPrice <= 0))) { dropped++; continue; }
    if (cfg.ratio && !(ratio > 0)) { dropped++; continue; }
    const fx = ticker && currencyOf[ticker] === 'USD' ? (num(t.fx) > 0 ? num(t.fx) : 1) : 1;
    s.transactions.push({ id: freshId(t.id), date: t.date, type, assetTicker: ticker, quantity, unitPrice,
      total: cfg.qty ? round2(quantity * unitPrice) : cfg.ratio ? 0 : Math.max(0, round2(t.total)),
      fee: cfg.qty ? Math.max(0, round2(t.fee)) : 0, fx, ratio, notes: str(t.notes, 300),
      createdAt: str(t.createdAt, 40) || new Date().toISOString() });
  }
  for (const a of arr(raw.announcements)) {
    const ticker = cleanTicker(a?.ticker);
    if (!tickers.has(ticker) || !ANNOUNCE_TYPES.includes(a.type) || !(num(a.perShare) > 0) || !isDate(a.payDate)) { dropped++; continue; }
    s.announcements.push({ id: freshId(a.id), ticker, type: a.type, perShare: num(a.perShare), dateCom: isDate(a.dateCom) ? a.dateCom : '',
      payDate: a.payDate, status: a.status === 'received' ? 'received' : 'pending', txId: str(a.txId, 64), notes: str(a.notes, 200) });
  }
  for (const [type, cfg] of Object.entries(WEALTH)) {
    for (const x of arr(raw[cfg.key])) {
      const name = str(x?.name, 100);
      if (!name) { dropped++; continue; }
      let amount = round2(x[cfg.amount]);
      if (!cfg.allowNeg) amount = Math.max(0, amount);
      const legacyType = x.type === 'Corretora' ? 'Saldo em corretora' : x.type;
      const o = { id: freshId(x.id), name, type: cfg.types.includes(legacyType) ? legacyType : cfg.types[cfg.types.length - 1], notes: str(x.notes, 300), updatedAt: str(x.updatedAt, 40) };
      o[cfg.amount] = amount;
      if (type === 'account') o.institution = str(x.institution, 80);
      s[cfg.key].push(o);
    }
  }
  if (raw.history && typeof raw.history === 'object') {
    for (const [k, v] of Object.entries(raw.history)) if (/^\d{4}-\d{2}$/.test(k) && v && typeof v === 'object') s.history[k] = { net: round2(v.net), invested: round2(v.invested), at: isDate(v.at) ? v.at : '' };
  }
  s.updatedAt = str(raw.updatedAt, 40);
  return { state: s, dropped };
}

/* ---------- Estado vivo ---------- */
export let state = emptyState();
export let db = null;
/** Contador de revisões: muda a cada gravação; os cálculos em cache se baseiam nele. */
export let rev = 0;
export function setState(s) { state = s; rev++; }
export function touch() { rev++; }
export const hasData = () => !!(state.assets.length || state.transactions.length || state.accounts.length || state.properties.length || state.liabilities.length);
export const getAsset = t => state.assets.find(a => a.ticker === t);
export const clone = o => JSON.parse(JSON.stringify(o));

let renderer = () => {}, snapshotter = () => {};
export function configureStore({ render, snapshot }) { renderer = render; snapshotter = snapshot; }

/* ---------- IndexedDB ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'key' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const idbGet = () => new Promise((resolve, reject) => {
  const r = db.transaction(STORE).objectStore(STORE).get('main');
  r.onsuccess = () => resolve(r.result?.value || null); r.onerror = () => reject(r.error);
});
const idbPut = value => new Promise((resolve, reject) => {
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({ key: 'main', value, updatedAt: value.updatedAt });
  tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
});

export async function persist() {
  rev++;
  if (hasData()) snapshotter();
  state.updatedAt = new Date().toISOString();
  let lsOk = true, idbOk = false;
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (err) { lsOk = false; console.warn('localStorage indisponível', err); }
  if (db) { try { await idbPut(clone(state)); idbOk = true; } catch (err) { console.warn('IndexedDB falhou', err); } }
  if (!lsOk && !idbOk) throw new Error('não há espaço de armazenamento disponível no navegador.');
}
/** Salva, re-renderiza e mostra mensagem. `undo`: estado anterior para oferecer "Desfazer". */
export async function commit(msg, { undo = null } = {}) {
  try { await persist(); }
  catch (err) { renderer(); toast('Não foi possível salvar: ' + err.message + ' Exporte um backup.', true); return false; }
  renderer();
  if (msg) toast(msg, false, undo ? { label: 'Desfazer', run: async () => { setState(undo); await commit('Alteração desfeita.'); } } : null);
  return true;
}

export async function initStore() {
  try { db = await openDB(); } catch (_) { db = null; }
  let ls = null, idb = null;
  try { const raw = localStorage.getItem(STATE_KEY); if (raw) ls = JSON.parse(raw); } catch (_) {}
  if (db) { try { idb = await idbGet(); } catch (_) {} }
  let saved = ls;
  if (idb && (!ls || String(idb.updatedAt || '') > String(ls.updatedAt || ''))) saved = idb;
  if (!saved) { setState(emptyState()); return; }
  const oldVersion = num(saved.version) || 1;
  if (oldVersion < SCHEMA_VERSION) keepBackup('migracao', saved, oldVersion);
  const { state: s, dropped } = normalizeState(saved);
  setState(s);
  if (oldVersion < SCHEMA_VERSION || dropped) { try { await persist(); } catch (_) {} }
  if (dropped) setTimeout(() => toast(`${plural(dropped, 'registro inválido foi ignorado', 'registros inválidos foram ignorados')} ao carregar.`), 600);
}

/** Recarrega o estado gravado por outra aba. */
export function reloadFromStorage(json) { try { setState(normalizeState(JSON.parse(json)).state); return true; } catch (_) { return false; } }

/* ---------- Cópias automáticas locais ---------- */
const backupStamp = k => (k.match(/\d{4}-\d{2}-\d{2}T[\d-]+Z/) || [''])[0];
export function listBackups() {
  const keys = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(BACKUP_PREFIX)) keys.push(k); } } catch (_) {}
  return keys.sort((a, b) => backupStamp(b).localeCompare(backupStamp(a)));
}
function pruneBackups() { listBackups().slice(KEEP_BACKUPS).forEach(k => { try { localStorage.removeItem(k); } catch (_) {} }); }
export function keepBackup(reason, data = state, ver = SCHEMA_VERSION) {
  pruneBackups();
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    localStorage.setItem(BACKUP_PREFIX + stamp + '-' + reason, JSON.stringify({ app: 'Patrimonio PWA', schemaVersion: ver, backupReason: reason, exportedAt: new Date().toISOString(), state: clone(data) }));
    pruneBackups();
  } catch (err) { console.warn('Cópia local não criada', err); }
}
export const markBackup = () => { state.settings.lastBackupAt = today(); };
