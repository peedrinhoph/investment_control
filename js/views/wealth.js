/* Tela: Contas & bens. */
import { WEALTH } from '../config.js';
import { state, commit, clone } from '../store.js';
import { wealthTotals } from '../finance.js';
import { $, e, fmt, dateBR, round2, str, uid, toInput } from '../utils.js';
import { openModal, closeModal, toast, options } from '../ui.js';

export function render() {
  const w = wealthTotals();
  $('w-cash').textContent = fmt(w.cash); $('w-inv').textContent = fmt(w.investments); $('w-prop').textContent = fmt(w.properties); $('w-debt').textContent = fmt(w.debt);
  const actions = (type, x) => `<td class="actions-cell"><button class="btn sm" data-act="edit-wealth" data-type="${type}" data-id="${e(x.id)}">Editar</button><button class="btn sm danger" data-act="del-wealth" data-type="${type}" data-id="${e(x.id)}">Excluir</button></td>`;
  const name = x => `<td class="main"><b>${e(x.name)}</b>${x.notes ? `<div class="muted small">${e(x.notes)}</div>` : ''}</td>`;
  $('accountRows').innerHTML = state.accounts.map(x => `<tr>${name(x)}<td data-label="Tipo">${e(x.type)}</td><td data-label="Instituição">${e(x.institution || '—')}</td><td class="num ${x.balance < 0 ? 'negative' : ''}" data-label="Saldo">${fmt(x.balance)}</td><td class="num" data-label="Atualizado">${x.updatedAt ? dateBR(x.updatedAt.slice(0, 10)) : '—'}</td>${actions('account', x)}</tr>`).join('');
  $('propertyRows').innerHTML = state.properties.map(x => `<tr>${name(x)}<td data-label="Categoria">${e(x.type)}</td><td class="num" data-label="Valor">${fmt(x.value)}</td>${actions('property', x)}</tr>`).join('');
  $('liabilityRows').innerHTML = state.liabilities.map(x => `<tr>${name(x)}<td data-label="Tipo">${e(x.type)}</td><td class="num negative" data-label="Saldo devedor">${fmt(x.balance)}</td>${actions('liability', x)}</tr>`).join('');
  $('accountEmpty').classList.toggle('hidden', state.accounts.length > 0);
  $('propertyEmpty').classList.toggle('hidden', state.properties.length > 0);
  $('liabilityEmpty').classList.toggle('hidden', state.liabilities.length > 0);
}

function chooseWealth() {
  openModal('Novo registro', `<p class="muted small" style="margin-top:0">Escolha o tipo de registro.</p><div class="form-actions" style="justify-content:stretch">${Object.entries(WEALTH).map(([k, c]) => `<button class="btn primary" style="flex:1" type="button" data-act="new-wealth-type" data-type="${k}">${e(c.label)}</button>`).join('')}</div>`);
}
function showWealthForm(type, item = null) {
  const cfg = WEALTH[type];
  openModal((item ? 'Editar ' : 'Adicionar ') + cfg.label.toLowerCase(), `<form id="wealthForm"><div class="form-grid">
    <div class="field span2"><label for="w-n">Nome *</label><input id="w-n" name="name" required maxlength="100" value="${e(item?.name || '')}" placeholder="Ex.: Reserva de emergência"></div>
    <div class="field"><label for="w-t">Tipo</label><select id="w-t" name="type">${options(cfg.types, item?.type || cfg.types[0])}</select></div>
    ${type === 'account' ? `<div class="field"><label for="w-i">Instituição</label><input id="w-i" name="institution" maxlength="80" value="${e(item?.institution || '')}" placeholder="Banco ou instituição"></div>` : ''}
    <div class="field"><label for="w-a">${cfg.amountLabel}</label><input id="w-a" name="amount" type="text" inputmode="decimal" required value="${e(toInput(item?.[cfg.amount], 2))}" placeholder="Ex.: 1.500,00"></div>
    <div class="field span2"><label for="w-o">Observações</label><input id="w-o" name="notes" maxlength="300" value="${e(item?.notes || '')}"></div>
  </div><p class="muted small">Atualiza o balanço patrimonial. Não cria movimentação nem conta como aporte.</p><div class="form-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Salvar</button></div></form>`);
  $('wealthForm').onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.currentTarget.elements, nm = str(f.name.value, 100);
    if (!nm) return toast('Informe o nome.', true);
    let amount = round2(f.amount.value); if (!cfg.allowNeg) amount = Math.max(0, amount);
    const obj = { id: item?.id || uid(), name: nm, type: f.type.value, notes: str(f.notes.value, 300), updatedAt: new Date().toISOString() };
    obj[cfg.amount] = amount;
    if (type === 'account') obj.institution = str(f.institution.value, 80);
    const list = state[cfg.key], idx = list.findIndex(x => x.id === obj.id);
    if (idx >= 0) list[idx] = obj; else list.push(obj);
    closeModal(); await commit('Patrimônio atualizado.');
  };
}

export const actions = {
  'new-wealth': () => chooseWealth(),
  'new-wealth-type': el => showWealthForm(el.dataset.type),
  'edit-wealth': el => { const c = WEALTH[el.dataset.type]; if (c) showWealthForm(el.dataset.type, state[c.key].find(x => x.id === el.dataset.id)); },
  'del-wealth': async el => {
    const c = WEALTH[el.dataset.type]; if (!c) return;
    const before = clone(state);
    state[c.key] = state[c.key].filter(x => x.id !== el.dataset.id);
    await commit('Registro excluído.', { undo: before });
  }
};
