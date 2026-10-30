/* Tela: Relatórios & IR. */
import { INCOME_TYPES } from '../config.js';
import { state } from '../store.js';
import { sumType, allSales } from '../finance.js';
import { taxYears, bensDireitos, incomeReport, monthlyTax } from '../tax.js';
import { $, e, fmt, signed, signCls, qtyFmt, monthLabel, plural, monthNow } from '../utils.js';
import { options, toast } from '../ui.js';

let tab = 'bens';

export function render() {
  const sel = $('reportYear'), years = taxYears(), cur = sel.value;
  const defYear = years.includes(String(+monthNow().slice(0, 4) - 1)) && monthNow().slice(5) <= '05' ? String(+monthNow().slice(0, 4) - 1) : years[0] || monthNow().slice(0, 4);
  sel.innerHTML = options(years.length ? years : [monthNow().slice(0, 4)], cur || defYear);
  const year = sel.value;
  $('r-year-label').textContent = `· ano-calendário ${year}`;

  const sales = allSales().filter(s => s.date.startsWith(year)), realized = sales.reduce((s, x) => s + x.result, 0);
  $('r-realized').textContent = signed(realized); $('r-realized').className = 'value ' + signCls(realized);
  const rv = monthlyTax(year), darf = rv.reduce((s, r) => s + r.darf, 0);
  $('r-darf').textContent = fmt(darf);
  $('r-darf-sub').textContent = rv.some(r => r.tax > 0) ? `${plural(rv.filter(r => r.darf > 0).length, 'mês com DARF', 'meses com DARF')} (código 6015)` : 'Nenhum imposto devido no ano';
  const inc = sumType(INCOME_TYPES, year);
  $('r-income').textContent = fmt(inc); $('r-income-sub').textContent = `Dividendos, rendimentos, JCP e juros em ${year}`;
  $('r-flow').textContent = fmt(sumType(['COMPRA'], year)); $('r-flow-sub').textContent = `compras · vendas ${fmt(sumType(['VENDA'], year))}`;

  /* Bens e direitos */
  const bens = bensDireitos(+year);
  $('r-tab-bens').innerHTML = bens.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>Ativo</th><th>Grupo · código (sugestão)</th><th class="num">31/12/${year - 1}</th><th class="num">31/12/${year}</th><th>Discriminação</th><th></th></tr></thead><tbody>${bens.map((b, i) => `<tr>
    <td class="main"><b>${e(b.asset.ticker)}</b><div class="muted small">${e(b.asset.name)}${b.asset.cnpj ? ` · CNPJ ${e(b.asset.cnpj)}` : ' · <span class="warn">sem CNPJ</span>'}</div></td>
    <td data-label="Grupo · código">${e(b.group.code)}<div class="muted small">${e(b.group.label)}</div></td>
    <td class="num" data-label="Situação em 31/12/${year - 1}">${fmt(b.costPrev)}<div class="muted small">${b.qtyPrev ? qtyFmt(b.qtyPrev) + ' un.' : '—'}</div></td>
    <td class="num" data-label="Situação em 31/12/${year}"><b>${fmt(b.costEnd)}</b><div class="muted small">${b.qtyEnd ? qtyFmt(b.qtyEnd) + ' un.' : '—'}</div></td>
    <td class="two-line wide" data-label="Discriminação" id="disc-${i}">${e(b.text)}</td>
    <td class="actions-cell"><button class="btn sm" data-act="copy-text" data-target="disc-${i}">Copiar</button></td></tr>`).join('')}</tbody></table></div>
    <p class="muted small mt">Na declaração, a "situação" é o <b>custo de aquisição</b>, não o valor de mercado. Informe CNPJ e corretora no cadastro de cada ativo para completar a discriminação.</p>`
    : '<div class="empty small">Nenhuma posição em 31/12 deste ano ou do anterior.</div>';

  /* Rendimentos */
  const rend = incomeReport(+year);
  const tot = rend.reduce((o, r) => { o.d += r.dividendos; o.r += r.rendimentos; o.j += r.jcp; o.x += r.juros; return o; }, { d: 0, r: 0, j: 0, x: 0 });
  $('r-tab-rend').innerHTML = rend.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>Pagador</th><th class="num">Dividendos (isento)</th><th class="num">Rendimentos FII (isento)</th><th class="num">JCP (exclusivo)</th><th class="num">Juros (tributável/exclusivo)</th></tr></thead><tbody>${rend.map(r => `<tr>
    <td class="main"><b>${e(r.ticker === '—' ? 'Sem ativo' : r.ticker)}</b><div class="muted small">${e(r.asset?.name || '')}${r.asset?.cnpj ? ` · CNPJ ${e(r.asset.cnpj)}` : ''}</div></td>
    <td class="num" data-label="Dividendos">${r.dividendos ? fmt(r.dividendos) : '—'}</td><td class="num" data-label="Rendimentos FII">${r.rendimentos ? fmt(r.rendimentos) : '—'}</td>
    <td class="num" data-label="JCP">${r.jcp ? fmt(r.jcp) : '—'}</td><td class="num" data-label="Juros">${r.juros ? fmt(r.juros) : '—'}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td class="main">Total</td><td class="num" data-label="Dividendos">${fmt(tot.d)}</td><td class="num" data-label="Rendimentos FII">${fmt(tot.r)}</td><td class="num" data-label="JCP">${fmt(tot.j)}</td><td class="num" data-label="Juros">${fmt(tot.x)}</td></tr></tfoot></table></div>
    <p class="muted small mt">Dividendos e rendimentos de FII entram em "Rendimentos isentos"; JCP em "Rendimentos sujeitos à tributação exclusiva" (use o valor líquido registrado). Confira com o informe de rendimentos de cada pagador.</p>`
    : '<div class="empty small">Nenhum provento no ano.</div>';

  /* Renda variável mensal */
  $('r-tab-rv').innerHTML = rv.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>Mês</th><th class="num">Vendas em ações</th><th class="num">Resultado ações</th><th class="num">ETF/BDR</th><th class="num">FII</th><th class="num">Prejuízo a compensar</th><th class="num">Imposto</th><th class="num">DARF</th></tr></thead><tbody>${rv.map(r => `<tr>
    <td class="main"><b>${e(monthLabel(r.month))}</b> ${r.acoesGross ? (r.exempt ? '<span class="pill green">ações isentas</span>' : '<span class="pill yellow">acima de R$ 20 mil</span>') : ''}</td>
    <td class="num" data-label="Vendas em ações">${r.acoesGross ? fmt(r.acoesGross) : '—'}</td>
    <td class="num ${signCls(r.acoes)}" data-label="Resultado ações">${r.acoesGross ? signed(r.acoes) : '—'}</td>
    <td class="num ${signCls(r.comum)}" data-label="ETF/BDR">${r.comum ? signed(r.comum) : '—'}</td>
    <td class="num ${signCls(r.fii)}" data-label="FII">${r.fii ? signed(r.fii) : '—'}</td>
    <td class="num" data-label="Prejuízo a compensar">${r.lossComum || r.lossFii ? `${fmt(r.lossComum)}${r.lossFii ? `<div class="small muted">FII ${fmt(r.lossFii)}</div>` : ''}` : '—'}</td>
    <td class="num" data-label="Imposto">${r.tax ? fmt(r.tax) : '—'}</td>
    <td class="num" data-label="DARF"><b>${r.darf ? fmt(r.darf) : r.carry ? `<span class="muted small">acumula ${fmt(r.carry)}</span>` : '—'}</b></td></tr>`).join('')}</tbody></table></div>
    ${rv.some(r => r.outros) ? `<p class="muted small mt">Resultados de outras classes no ano (informativo): ${fmt(rv.reduce((s, r) => s + r.outros, 0))}.</p>` : ''}
    <p class="muted small mt">DARF de renda variável: código 6015, vence no último dia útil do mês seguinte ao da venda. Ganho isento de ações vai em "Rendimentos isentos"; o restante, na ficha "Renda variável".</p>`
    : '<div class="empty small">Nenhuma venda no ano.</div>';
  setTab(tab);

  /* Resumo anual */
  $('r-years').innerHTML = years.map(y => {
    const r = allSales().filter(s => s.date.startsWith(y)).reduce((s, x) => s + x.result, 0);
    return `<tr><td class="main"><b>${y}</b></td><td class="num" data-label="Compras">${fmt(sumType(['COMPRA'], y))}</td><td class="num" data-label="Vendas">${fmt(sumType(['VENDA'], y))}</td><td class="num ${signCls(r)}" data-label="Realizado">${signed(r)}</td><td class="num" data-label="Proventos">${fmt(sumType(INCOME_TYPES, y))}</td><td class="num" data-label="Aportes externos">${fmt(sumType(['APORTE'], y))}</td><td class="num" data-label="Retiradas">${fmt(sumType(['RETIRADA'], y))}</td><td class="num" data-label="Taxas">${fmt(sumType(['TAXA'], y))}</td></tr>`;
  }).join('') || '<tr><td class="main muted">Sem movimentações.</td></tr>';
}

function setTab(name) {
  tab = name;
  document.querySelectorAll('#page-reports .tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  ['bens', 'rend', 'rv'].forEach(k => $('r-tab-' + k).classList.toggle('hidden', k !== name));
}

export const actions = {
  'copy-text': async el => {
    const text = $(el.dataset.target)?.textContent || '';
    try { await navigator.clipboard.writeText(text); toast('Texto copiado.'); } catch (_) { toast('Não foi possível copiar.', true); }
  },
  'print': () => window.print()
};
export function bind() {
  $('reportYear').addEventListener('change', render);
  document.querySelector('#page-reports .tabs').addEventListener('click', ev => { const b = ev.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
}
