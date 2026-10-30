/* Utilitários: números (aceita vírgula), datas locais, formatação e escape de HTML. */
import { MONTHS } from './config.js';
import { prefs } from './prefs.js';

export const $ = id => document.getElementById(id);
export const arr = v => Array.isArray(v) ? v : [];

/**
 * Converte texto em número aceitando formatos brasileiro e internacional:
 * "1.234,56", "1234,56", "39.82", "R$ 10", "(5,00)" → -5.
 * Um ponto seguido de exatamente 3 dígitos é milhar ("8.000" = 8000); senão é decimal ("39.82", "0.005").
 */
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').trim().replace(/R\$|US\$|\s| /g, '');
  if (!s || s === '-') return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  const hasC = s.includes(','), hasD = s.includes('.');
  if (hasC && hasD) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (hasC) s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  else if (hasD && s.split('.').length > 2) s = s.replace(/\./g, '');
  else if (hasD && /^-?[1-9]\d{0,2}\.\d{3}$/.test(s)) s = s.replace('.', ''); // "8.000" = oito mil (padrão brasileiro)
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}
export const round2 = v => Math.round((num(v) + Number.EPSILON) * 100) / 100;
export const round = (v, d = 6) => { const f = 10 ** d; return Math.round((num(v) + Number.EPSILON) * f) / f; };
/** Valor para preencher um campo de texto numérico, no formato brasileiro e sem separador de milhar. */
export const toInput = (n, max = 8) => (n === '' || n === null || n === undefined || !Number.isFinite(Number(n)) || Number(n) === 0) ? '' : Number(n).toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: max });

export const pad = n => String(n).padStart(2, '0');
export const localISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => localISO();
export const monthNow = () => today().slice(0, 7);
export const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const daysBetween = (a, b) => isDate(a) && isDate(b) ? Math.round((parseDate(b) - parseDate(a)) / 864e5) : 0;
export const daysSince = s => isDate(s) ? daysBetween(s, today()) : Infinity;
export const addMonths = (ym, k) => { let [y, m] = ym.split('-').map(Number); m += k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${pad(m)}`; };
export const addDays = (iso, k) => { const d = parseDate(iso); d.setDate(d.getDate() + k); return localISO(d); };
export const dateBR = s => { if (!isDate(s)) return '—'; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
export const monthLabel = ym => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]}/${y.slice(2)}`; };
/** Aceita "dd/mm/aaaa", "aaaa-mm-dd" ou número serial do Excel. */
export function parseAnyDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
export const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const cleanId = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)) ? v : uid();
export const cleanTicker = v => { const t = str(v, 20).toUpperCase().replace(/\s+/g, ''); return /^[A-Z0-9._-]{1,20}$/.test(t) ? t : ''; };
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const isTouch = () => matchMedia('(pointer: coarse)').matches;
export const normText = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const money = (n, cur = 'BRL') => num(n).toLocaleString('pt-BR', { style: 'currency', currency: cur });
export const fmt = (n, cur = 'BRL') => prefs.hide ? (cur === 'USD' ? 'US$ •••••' : 'R$ •••••') : money(n, cur);
export const pct = (n, d = 1) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
export const qtyFmt = n => num(n).toLocaleString('pt-BR', { maximumFractionDigits: 8 });
export const compact = n => num(n).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
export const signCls = n => n > 0.005 ? 'positive' : n < -0.005 ? 'negative' : '';
export const signed = (n, cur) => (n > 0.005 ? '+' : '') + fmt(n, cur);
export const ratioLabel = r => { r = num(r); if (!r) return '—'; return r >= 1 ? `1 : ${qtyFmt(round(r, 6))}` : `${qtyFmt(round(1 / r, 6))} : 1`; };
export const durationLabel = months => {
  if (months === null || months === undefined) return '—';
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? plural(y, 'ano', 'anos') : '', m ? plural(m, 'mês', 'meses') : ''].filter(Boolean).join(' e ') || 'agora';
};
