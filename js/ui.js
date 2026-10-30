/* Componentes de interface: toast, modal, download e pequenos geradores de HTML. */
import { $, e, isTouch } from './utils.js';

let toastTimer = null;
/** Mostra uma mensagem curta. `action` opcional: { label, run } (ex.: "Desfazer"). */
export function toast(msg, error = false, action = null) {
  const el = $('toast'), btn = $('toastAction');
  $('toastMsg').textContent = msg;
  el.classList.toggle('error', error);
  el.classList.add('show');
  btn.classList.toggle('hidden', !action);
  btn.onclick = null;
  if (action) { btn.textContent = action.label; btn.onclick = () => { el.classList.remove('show'); action.run(); }; }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 7000 : error ? 5000 : 2600);
}

let lastFocus = null;
export function openModal(title, html, { wide = false } = {}) {
  lastFocus = document.activeElement;
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modal').classList.toggle('wide', wide);
  $('modalBackdrop').classList.add('open');
  document.body.classList.add('modal-open');
  $('modal').scrollTop = 0;
  if (!isTouch()) setTimeout(() => $('modalBody').querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([readonly]),select,textarea')?.focus({ preventScroll: true }), 40);
}
export function closeModal() {
  if (!isModalOpen()) return;
  $('modalBackdrop').classList.remove('open');
  document.body.classList.remove('modal-open');
  $('modalBody').innerHTML = '';
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus?.({ preventScroll: true });
}
export const isModalOpen = () => $('modalBackdrop').classList.contains('open');

/** Pede uma senha num modal. Retorna a senha ou null se cancelado. */
export function askPassword({ title, text = '', confirm = false, submitLabel = 'Continuar' }) {
  return new Promise(resolve => {
    openModal(title, `<form id="pwForm"><p class="muted small" style="margin-top:0">${text}</p><div class="form-grid">
      <div class="field ${confirm ? '' : 'span2'}"><label for="pw1">Senha</label><input id="pw1" type="password" autocomplete="${confirm ? 'new-password' : 'current-password'}" minlength="${confirm ? 8 : 1}" required></div>
      ${confirm ? '<div class="field"><label for="pw2">Repita a senha</label><input id="pw2" type="password" autocomplete="new-password" required></div>' : ''}
    </div><div class="form-actions"><button type="button" class="btn" id="pwCancel">Cancelar</button><button class="btn primary" type="submit">${e(submitLabel)}</button></div></form>`);
    let done = false;
    const finish = v => { if (done) return; done = true; closeModal(); resolve(v); };
    $('pwCancel').onclick = () => finish(null);
    $('pwForm').onsubmit = ev => {
      ev.preventDefault();
      const p1 = $('pw1').value;
      if (confirm && p1.length < 8) return toast('Use pelo menos 8 caracteres.', true);
      if (confirm && p1 !== $('pw2').value) return toast('As senhas não conferem.', true);
      finish(p1);
    };
    const obs = new MutationObserver(() => { if (!isModalOpen()) { obs.disconnect(); finish(null); } });
    obs.observe($('modalBackdrop'), { attributes: true, attributeFilter: ['class'] });
  });
}

export const options = (list, selected) => list.map(v => `<option ${v === selected ? 'selected' : ''} value="${e(v)}">${e(v)}</option>`).join('');
export const optionsMap = (map, selected) => Object.entries(map).map(([k, v]) => `<option value="${e(k)}" ${k === selected ? 'selected' : ''}>${e(typeof v === 'string' ? v : v.label)}</option>`).join('');

export function download(name, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
/** No celular abre a folha de compartilhamento (salvar no Drive, enviar etc.); no desktop baixa o arquivo. */
export async function shareOrDownload(name, content, type) {
  if (isTouch() && navigator.canShare) {
    try {
      const file = new File([content], name, { type });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true; }
    } catch (err) { if (err.name === 'AbortError') return false; }
  }
  download(name, content, type);
  return true;
}
