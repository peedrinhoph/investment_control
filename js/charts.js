/* Gráficos em SVG puro (sem bibliotecas), usando as cores do tema via CSS. */
import { prefs } from './prefs.js';
import { e, fmt, pct, compact } from './utils.js';

/** Barras. items: [{label, value, value2?}] — value2 empilhado (ex.: "a receber"). ref: linha de meta. */
export function barChart(items, ref = 0) {
  const tot = i => (i.value || 0) + (i.value2 || 0);
  if (!items.some(i => tot(i) > 0) && !ref) return '<div class="empty small">Sem dados no período.</div>';
  const W = 600, H = 180, pb = 26, pt = 22, ih = H - pb - pt, bw = W / items.length;
  const max = Math.max(ref, ...items.map(tot)) || 1;
  let svg = items.map((it, i) => {
    const h1 = Math.max(0, ih * (it.value || 0) / max), h2 = Math.max(0, ih * (it.value2 || 0) / max);
    const x = i * bw + bw * 0.18, w = bw * 0.64, cx = i * bw + bw / 2, base = H - pb;
    const title = `${it.label}: ${fmt(it.value || 0)}${it.value2 ? ` + ${fmt(it.value2)} a receber` : ''}`;
    return `<g><title>${e(title)}</title><rect class="bar" x="${x.toFixed(1)}" y="${(base - h1).toFixed(1)}" width="${w.toFixed(1)}" height="${h1.toFixed(1)}" rx="4"/>`
      + (h2 ? `<rect class="bar alt" x="${x.toFixed(1)}" y="${(base - h1 - h2).toFixed(1)}" width="${w.toFixed(1)}" height="${h2.toFixed(1)}" rx="4"/>` : '')
      + (!prefs.hide && tot(it) > 0 ? `<text class="val" x="${cx.toFixed(1)}" y="${(base - h1 - h2 - 6).toFixed(1)}" text-anchor="middle">${e(compact(tot(it)))}</text>` : '')
      + `<text class="axis" x="${cx.toFixed(1)}" y="${H - 7}" text-anchor="middle">${e(it.label)}</text></g>`;
  }).join('');
  if (ref > 0) { const y = (pt + ih * (1 - ref / max)).toFixed(1); svg += `<line class="ref" x1="0" x2="${W}" y1="${y}" y2="${y}"><title>Meta: ${e(fmt(ref))}</title></line>`; }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras">${svg}<line class="base" x1="0" x2="${W}" y1="${H - pb}" y2="${H - pb}"/></svg>`;
}

/** Linha. points: [{label, value}]. ref: linha horizontal (ex.: meta de patrimônio). */
export function lineChart(points, { empty = 'Sem dados suficientes.', ref = 0 } = {}) {
  if (points.length < 2) return `<div class="empty small">${e(empty)}</div>`;
  const W = 600, H = 190, pl = 10, pr = 10, pt = 14, pb = 26;
  const vals = points.map(p => p.value).concat(ref ? [ref] : []);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max === min) { max += Math.abs(max) * 0.1 || 1; min -= Math.abs(min) * 0.1 || 1; }
  const x = i => pl + i * (W - pl - pr) / (points.length - 1), y = v => pt + (H - pt - pb) * (1 - (v - min) / (max - min));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const step = Math.ceil(points.length / 6);
  const labels = points.map((p, i) => {
    const last = i === points.length - 1;
    if (!(i % step === 0 || last) || (!last && points.length - 1 - i < step / 2)) return '';
    return `<text class="axis" x="${x(i).toFixed(1)}" y="${H - 7}" text-anchor="${i === 0 ? 'start' : last ? 'end' : 'middle'}">${e(p.label)}</text>`;
  }).join('');
  const refLine = ref ? `<line class="ref" x1="0" x2="${W}" y1="${y(ref).toFixed(1)}" y2="${y(ref).toFixed(1)}"><title>Meta: ${e(fmt(ref))}</title></line>` : '';
  const dots = points.length <= 40 ? points.map((p, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4"><title>${e(p.label)}: ${e(fmt(p.value))}</title></circle>`).join('') : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de linha"><path class="area" d="${d} L${x(points.length - 1).toFixed(1)},${H - pb} L${x(0).toFixed(1)},${H - pb} Z"/>${refLine}<path class="line" d="${d}"/>${dots}${labels}<line class="base" x1="0" x2="${W}" y1="${H - pb}" y2="${H - pb}"/></svg>`;
}

/** Lista de barras horizontais com valor e percentual. limit: destaca em amarelo acima do limite (%). */
export function barList(obj, total, { withPct = true, limit = 0 } = {}) {
  const entries = Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<div class="empty small">Sem dados para exibir.</div>';
  return entries.map(([k, v]) => {
    const p = total ? v / total * 100 : 0, over = limit > 0 && p > limit;
    return `<div class="bar-row"><span title="${e(k)}">${e(k)}</span><div class="bar-track"><div class="bar-fill ${over ? 'warn' : ''}" style="width:${Math.min(100, p).toFixed(2)}%"></div></div><b>${fmt(v)}${withPct && total ? ` <span class="${over ? 'warn' : 'muted'}">${pct(p)}</span>` : ''}</b></div>`;
  }).join('');
}
