/* Preferências deste dispositivo (não vão para o backup): privacidade, tema e cotações automáticas. */
import { PREF_KEY } from './config.js';

const DEFAULTS = {
  hide: false,
  theme: 'auto',                       // 'auto' | 'dark' | 'light'
  quotes: { provider: 'off', token: '', auto: false, fx: false, rates: false, lastRun: '' }
};

export const prefs = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    return { ...DEFAULTS, ...saved, quotes: { ...DEFAULTS.quotes, ...(saved.quotes || {}) } };
  } catch (_) { return structuredClone(DEFAULTS); }
})();

export function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (_) {} }

const darkQuery = matchMedia('(prefers-color-scheme: light)');
export function resolvedTheme() { return prefs.theme === 'auto' ? (darkQuery.matches ? 'light' : 'dark') : prefs.theme; }
export function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f3f5f9' : '#0b1020');
}
darkQuery.addEventListener?.('change', () => { if (prefs.theme === 'auto') applyTheme(); });
