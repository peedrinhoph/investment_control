/*
 * Importação dos extratos da Área do Investidor da B3 (arquivos .xlsx ou .csv):
 *  - Movimentação: compras/vendas liquidadas, proventos, desdobramentos, grupamentos, bonificações.
 *  - Negociação: compras e vendas na data do pregão.
 *  - Posição: conferência de quantidades e preço de fechamento.
 * O leitor de .xlsx é próprio (zip + XML), sem bibliotecas externas.
 */
import { TX_TYPES } from './config.js';
import { state, getAsset } from './store.js';
import { buildLedger, sequenceError } from './finance.js';
import { num, round, round2, parseAnyDate, normText, cleanTicker, uid } from './utils.js';

/* ---------------- Leitura de arquivos ---------------- */
async function inflateRaw(bytes) {
  if (!('DecompressionStream' in window)) throw new Error('seu navegador não descompacta .xlsx; exporte em CSV.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), files = {};
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('arquivo .xlsx inválido.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const td = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!/\.(xml|rels)$/i.test(name)) continue;
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = u8.subarray(start, start + csize);
    files[name] = td.decode(method === 8 ? await inflateRaw(data) : method === 0 ? data : new Uint8Array());
  }
  return files;
}
const colIndex = ref => { const letters = String(ref).replace(/\d+/g, ''); let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
function parseSheet(xml, shared) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml'), rows = [];
  for (const row of doc.getElementsByTagName('row')) {
    const out = [];
    for (const c of row.getElementsByTagName('c')) {
      const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0]?.textContent;
      let val;
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
      else if (t === 'str' || t === 'b' || t === 'e') val = v ?? '';
      else val = v === undefined ? '' : Number(v);
      out[colIndex(c.getAttribute('r') || '')] = val;
    }
    rows.push(Array.from(out, x => x ?? ''));
  }
  return rows;
}
export async function readXlsx(buf) {
  const files = await unzip(buf);
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    const doc = new DOMParser().parseFromString(files['xl/sharedStrings.xml'], 'application/xml');
    for (const si of doc.getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
  }
  const sheets = [];
  const wb = files['xl/workbook.xml'], rels = files['xl/_rels/workbook.xml.rels'];
  if (wb && rels) {
    const relDoc = new DOMParser().parseFromString(rels, 'application/xml'), map = {};
    for (const r of relDoc.getElementsByTagName('Relationship')) map[r.getAttribute('Id')] = r.getAttribute('Target');
    const wbDoc = new DOMParser().parseFromString(wb, 'application/xml');
    for (const s of wbDoc.getElementsByTagName('sheet')) {
      const target = map[s.getAttribute('r:id')] || '';
      const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      if (files[path]) sheets.push({ name: s.getAttribute('name') || path, rows: parseSheet(files[path], shared) });
    }
  }
  if (!sheets.length) Object.keys(files).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort().forEach(k => sheets.push({ name: k, rows: parseSheet(files[k], shared) }));
  return sheets;
}
export function readCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return [{ name: 'CSV', rows }];
}
export async function readTabular(file) {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return readCsv(await file.text());
  return readXlsx(await file.arrayBuffer());
}

/* ---------------- Interpretação ---------------- */
function findHeader(rows, required) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = rows[i].map(normText);
    if (required.every(r => h.some(c => c.startsWith(r)))) return { idx: i, cols: h };
  }
  return null;
}
const colOf = (cols, ...names) => { for (const n of names) { const i = cols.findIndex(c => c.startsWith(n)); if (i >= 0) return i; } return -1; };

const TD_WORDS = [[/^tesouro\s*/i, 'TD-'], [/ipca\+?\s*com juros semestrais/i, 'IPCA-JS'], [/prefixado com juros semestrais/i, 'PRE-JS'], [/ipca\+?/i, 'IPCA'], [/prefixado/i, 'PRE'], [/selic/i, 'SELIC'], [/renda\+?\s*aposentadoria extra/i, 'RENDA'], [/renda\+?/i, 'RENDA'], [/educa\+?/i, 'EDUCA'], [/igp-?m\+?\s*com juros semestrais/i, 'IGPM-JS']];
function tesouroTicker(name) {
  let s = String(name).trim();
  for (const [re, rep] of TD_WORDS) s = s.replace(re, rep + ' ');
  s = s.toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleanTicker(s.slice(0, 20));
}
export function tickerFrom(prod) {
  const raw = String(prod ?? '').trim();
  if (/^tesouro/i.test(raw)) return tesouroTicker(raw.split(' - ')[0]);
  let t = raw.split(' - ')[0].trim().toUpperCase().replace(/\s+/g, '');
  const frac = t.match(/^([A-Z]{4}\d{1,2})F$/); if (frac) t = frac[1];
  return cleanTicker(t);
}
const nameFrom = prod => { const s = String(prod ?? ''); const i = s.indexOf(' - '); return (i >= 0 ? s.slice(i + 3) : s).trim().slice(0, 80); };
const KNOWN_UNITS = new Set(['TAEE11', 'SANB11', 'KLBN11', 'BPAC11', 'ALUP11', 'ENGI11', 'SAPR11', 'TIET11', 'AESB11', 'BRBI11', 'IGTI11', 'CPLE11', 'ENEV11', 'RNEW11', 'SULA11', 'CMIG11', 'ITSA11', 'BBDC11', 'PSSA11', 'TRPL11']);
const KNOWN_ETFS = new Set(['BOVA11', 'BOVV11', 'BOVX11', 'IVVB11', 'SMAL11', 'HASH11', 'XINA11', 'GOLD11', 'DIVO11', 'NASD11', 'SPXI11', 'ECOO11', 'ACWI11', 'QBTC11', 'ETHE11', 'B5P211', 'IMAB11', 'FIXA11', 'IRFM11', 'BRAX11', 'PIBB11', 'SPXR11', 'WRLD11', 'EURP11', 'TECK11', 'NDIV11', 'LFTS11']);
export function guessClass(ticker, name = '') {
  const n = normText(name);
  if (KNOWN_UNITS.has(ticker)) return 'Ação';
  if (KNOWN_ETFS.has(ticker)) return 'ETF';
  if (/^TD-/.test(ticker) || /tesouro|cdb|lci|lca|cri |cra |debenture|lc /.test(n)) return 'Renda fixa';
  if (/^[A-Z]{4}3[2-9]$/.test(ticker)) return 'BDR';
  if (/^[A-Z]{4}11$/.test(ticker)) {
    if (/imobiliari|fii|imob/.test(n)) return 'FII';
    if (/etf|indice|index|ishares|it now|trend|fundo de/.test(n)) return 'ETF';
    return 'FII';
  }
  return 'Ação';
}

/** Mapeia uma linha do extrato de Movimentação para um candidato a movimentação. */
function mapMovement(mov, dir) {
  const m = normText(mov), credit = normText(dir).startsWith('cred');
  if (m === 'transferencia - liquidacao' || m === 'compra / venda' || m === 'compra/venda' || m === 'compra' || m === 'venda') return { type: credit ? 'COMPRA' : 'VENDA', settlement: true };
  if (m === 'dividendo') return { type: 'DIVIDENDO' };
  if (m.startsWith('juros sobre capital')) return { type: 'JCP' };
  if (m === 'rendimento') return { type: 'RENDIMENTO' };
  if (m === 'desdobro' || m === 'desdobramento') return { type: 'DESDOBRAMENTO' };
  if (m === 'grupamento') return { type: 'GRUPAMENTO' };
  if (m.startsWith('bonificacao')) return { type: 'BONIFICACAO' };
  return null;
}

/** Lê planilhas da B3 e devolve candidatos, linhas de posição e linhas ignoradas. */
export function parseB3(sheets) {
  const cands = [], positions = [], ignored = {}, kinds = new Set();
  for (const sh of sheets) {
    const rows = sh.rows;
    let H = findHeader(rows, ['entrada/saida', 'data', 'movimentacao', 'produto']);
    if (H) {
      kinds.add('movimentação');
      const c = H.cols, iDir = colOf(c, 'entrada/saida'), iDate = colOf(c, 'data'), iMov = colOf(c, 'movimentacao'), iProd = colOf(c, 'produto'),
            iQty = colOf(c, 'quantidade'), iPrice = colOf(c, 'preco unitario', 'preco'), iVal = colOf(c, 'valor da operacao', 'valor');
      for (const r of rows.slice(H.idx + 1)) {
        if (!r[iMov] && !r[iProd]) continue;
        const date = parseAnyDate(r[iDate]), map = mapMovement(r[iMov], r[iDir]), ticker = tickerFrom(r[iProd]);
        const label = String(r[iMov] || '—').trim();
        if (!map || !date || !ticker) { ignored[label] = (ignored[label] || 0) + 1; continue; }
        cands.push({ ...map, date, ticker, name: nameFrom(r[iProd]), dir: normText(r[iDir]), quantity: Math.abs(num(r[iQty])), unitPrice: Math.abs(num(r[iPrice])), total: Math.abs(num(r[iVal])), source: 'Movimentação', movement: label });
      }
      continue;
    }
    H = findHeader(rows, ['data do negocio', 'tipo de movimentacao', 'codigo de negociacao']);
    if (H) {
      kinds.add('negociação');
      const c = H.cols, iDate = colOf(c, 'data do negocio'), iType = colOf(c, 'tipo de movimentacao'), iTk = colOf(c, 'codigo de negociacao'),
            iQty = colOf(c, 'quantidade'), iPrice = colOf(c, 'preco'), iVal = colOf(c, 'valor');
      for (const r of rows.slice(H.idx + 1)) {
        if (!r[iTk]) continue;
        const date = parseAnyDate(r[iDate]), t = normText(r[iType]), ticker = tickerFrom(r[iTk]);
        const type = t.startsWith('compra') ? 'COMPRA' : t.startsWith('venda') ? 'VENDA' : null;
        if (!type || !date || !ticker) { const l = String(r[iType] || '—'); ignored[l] = (ignored[l] || 0) + 1; continue; }
        cands.push({ type, date, ticker, name: '', quantity: Math.abs(num(r[iQty])), unitPrice: Math.abs(num(r[iPrice])), total: Math.abs(num(r[iVal])), source: 'Negociação', movement: type === 'COMPRA' ? 'Compra' : 'Venda' });
      }
      continue;
    }
    H = findHeader(rows, ['quantidade']);
    if (H && (colOf(H.cols, 'codigo de negociacao') >= 0 || colOf(H.cols, 'produto') >= 0)) {
      kinds.add('posição');
      const c = H.cols, iTk = colOf(c, 'codigo de negociacao'), iProd = colOf(c, 'produto'), iQty = colOf(c, 'quantidade'),
            iClose = colOf(c, 'preco de fechamento', 'preco unitario'), iVal = colOf(c, 'valor atualizado');
      for (const r of rows.slice(H.idx + 1)) {
        const ticker = tickerFrom(iTk >= 0 && r[iTk] ? r[iTk] : r[iProd]);
        const qty = num(r[iQty]);
        if (!ticker || !(qty > 0) || /^TOTAL/.test(ticker)) continue;
        positions.push({ ticker, name: nameFrom(r[iProd]), qty, close: iClose >= 0 ? num(r[iClose]) : 0, value: iVal >= 0 ? num(r[iVal]) : 0, sheet: sh.name });
      }
    }
  }
  return { cands, positions, ignored, kinds: [...kinds] };
}

const keyOf = t => [t.date, t.type, t.assetTicker, round(t.quantity, 6), round2(t.unitPrice), round2(t.total), round(t.ratio, 6)].join('|');
const isNear = (t, list) => list.some(x => x.type === t.type && x.assetTicker === t.assetTicker && Math.abs(num(x.quantity) - num(t.quantity)) < 1e-6
  && Math.abs(num(x.unitPrice) - num(t.unitPrice)) < 0.01 && Math.abs((new Date(x.date) - new Date(t.date)) / 864e5) <= 5);

/**
 * Converte candidatos em movimentações, sem duplicar as já registradas.
 * Desdobramentos/grupamentos viram fatores calculados pela posição na data.
 */
export function planImport(cands, { includeSettlement = true, includeNear = false } = {}) {
  const existing = state.transactions, keys = new Set(existing.map(keyOf));
  const txs = [], dup = [], near = [], warnings = [], newAssets = new Map(), skipped = {};
  const now = new Date().toISOString();
  const names = {}; cands.forEach(c => { if (c.name && (!names[c.ticker] || c.name.length > names[c.ticker].length)) names[c.ticker] = c.name; });
  const sorted = [...cands].sort((a, b) => a.date.localeCompare(b.date) || (TX_TYPES[a.type].ratio ? 1 : 0) - (TX_TYPES[b.type].ratio ? 1 : 0));
  for (const c of sorted) {
    if (c.settlement && !includeSettlement) { skipped['Compras/vendas da movimentação'] = (skipped['Compras/vendas da movimentação'] || 0) + 1; continue; }
    if (!getAsset(c.ticker) && !newAssets.has(c.ticker)) newAssets.set(c.ticker, { ticker: c.ticker, name: names[c.ticker] || c.ticker, assetClass: guessClass(c.ticker, names[c.ticker] || '') });
    const cfg = TX_TYPES[c.type];
    const tx = { id: uid(), date: c.date, type: c.type, assetTicker: c.ticker, quantity: 0, unitPrice: 0, total: 0, fee: 0, fx: 1, ratio: 0, notes: `Importado B3 (${c.source}: ${c.movement})`, createdAt: now };
    if (cfg.ratio) {
      const pos = buildLedger(existing.concat(txs).filter(t => t.assetTicker === c.ticker), c.date)[c.ticker]?.qty || 0;
      if (!(pos > 0) || !(c.quantity > 0)) { warnings.push(`${c.ticker}: ${cfg.label.toLowerCase()} em ${c.date} sem posição anterior — ignorado.`); continue; }
      tx.ratio = c.type === 'DESDOBRAMENTO' ? (pos + c.quantity) / pos : c.dir?.startsWith('deb') ? (pos - c.quantity) / pos : c.quantity / pos;
      if (!(tx.ratio > 0)) { warnings.push(`${c.ticker}: fator inválido no grupamento de ${c.date} — ignorado.`); continue; }
      tx.ratio = round(tx.ratio, 8);
    } else if (cfg.qty) {
      tx.quantity = c.quantity;
      tx.unitPrice = c.unitPrice || (c.quantity ? c.total / c.quantity : 0);
      if (c.type !== 'BONIFICACAO' && !(tx.quantity > 0 && tx.unitPrice > 0)) { warnings.push(`${c.ticker}: ${cfg.label.toLowerCase()} em ${c.date} sem quantidade ou preço — ignorado.`); continue; }
      if (!(tx.quantity > 0)) continue;
      tx.total = round2(tx.quantity * tx.unitPrice);
      if (c.type === 'BONIFICACAO' && !tx.unitPrice) warnings.push(`${c.ticker}: bonificação de ${c.date} sem custo atribuído — edite e informe o valor do fato relevante.`);
    } else {
      tx.total = round2(c.total || c.quantity * c.unitPrice);
      if (!(tx.total > 0)) continue;
    }
    const k = keyOf(tx);
    if (keys.has(k)) { dup.push(tx); continue; }
    if (!includeNear && isNear(tx, existing)) { near.push(tx); continue; }
    keys.add(k); txs.push(tx);
  }
  const affected = [...new Set(txs.map(t => t.assetTicker))];
  const err = sequenceError(existing.concat(txs), affected);
  if (err) warnings.push(`A posição de ${err.ticker} fica negativa em ${err.date}. Provavelmente falta histórico anterior (compras antigas): registre a posição inicial antes.`);
  return { txs, dup, near, warnings, newAssets: [...newAssets.values()], skipped };
}
