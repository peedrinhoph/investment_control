/*
 * Cotações e indicadores automáticos (opcional, desligado por padrão).
 * Cada provedor é isolado: falhas não afetam o app, e a digitação manual continua disponível.
 * Só os tickers são enviados; nenhum dado da carteira sai do dispositivo.
 * Para adicionar outro provedor, inclua um objeto em PROVIDERS com { label, needsToken, fetchQuote }.
 */
import { state, persist } from './store.js';
import { prefs, savePrefs } from './prefs.js';
import { isAutoRF, hasUsdAssets } from './finance.js';
import { num, today, parseAnyDate, localISO } from './utils.js';

const TIMEOUT = 10000;
async function getJSON(url, headers = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

export const PROVIDERS = {
  off: { label: 'Desligado' },
  brapi: {
    label: 'brapi.dev (ações, FIIs, ETFs e BDRs da B3)', needsToken: true, site: 'https://brapi.dev',
    tokenHint: 'Crie uma conta gratuita em brapi.dev para obter o token. Sem token, só alguns tickers de teste funcionam.',
    async fetchQuote(ticker, token) {
      const j = await getJSON(`https://brapi.dev/api/quote/${encodeURIComponent(ticker)}`, token ? { Authorization: `Bearer ${token}` } : {});
      const r = j?.results?.[0], d = r?.data || r;
      const price = num(d?.regularMarketPrice);
      if (!(price > 0)) throw new Error('sem preço');
      const time = d?.regularMarketTime ? new Date(d.regularMarketTime) : null;
      return { price, date: time && !isNaN(time) ? localISO(time) : today() };
    }
  }
};

/** Dólar comercial (AwesomeAPI). */
async function fetchUsd() {
  const j = await getJSON('https://economia.awesomeapi.com.br/json/last/USD-BRL');
  const bid = num(j?.USDBRL?.bid);
  if (!(bid > 0)) throw new Error('sem cotação');
  return bid;
}
/** Indicadores do Banco Central (SGS): CDI anualizado (4389), meta Selic (432), IPCA 12 meses (13522). */
async function fetchRates() {
  const get = async code => { const j = await getJSON(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/1?formato=json`); return { v: num(j?.[0]?.valor), d: parseAnyDate(j?.[0]?.data) }; };
  const [cdi, selic, ipca] = await Promise.allSettled([get(4389), get(432), get(13522)]);
  const ok = r => r.status === 'fulfilled' && r.value.v > 0 ? r.value : null;
  return { cdi: ok(cdi), selic: ok(selic), ipca: ok(ipca) };
}

export const quotesEnabled = () => prefs.quotes.provider !== 'off' || prefs.quotes.fx || prefs.quotes.rates;

/** Busca cotações dos ativos compatíveis sem alterar o estado da carteira. */
export async function fetchAssetQuotes() {
  const provider = PROVIDERS[prefs.quotes.provider];
  const out = { quotes: [], failed: [] };
  if (!provider?.fetchQuote) return out;

  const list = state.assets.filter(a => a.currency === 'BRL' && !isAutoRF(a) && ['Ação', 'FII', 'ETF', 'BDR'].includes(a.assetClass));
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const asset = list[i++];
      try {
        const quote = await provider.fetchQuote(asset.ticker, prefs.quotes.token);
        out.quotes.push({ asset, price: quote.price, date: quote.date });
      } catch (_) {
        out.failed.push(asset.ticker);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}

/**
 * Atualiza cotações, dólar e indicadores conforme as preferências.
 * Retorna um resumo { updated, failed: [tickers], fx, rates, errors }.
 */
export async function runQuoteUpdate() {
  const q = prefs.quotes, out = { updated: 0, failed: [], fx: false, rates: false, errors: [] };
  const fetched = await fetchAssetQuotes();
  fetched.quotes.forEach(({ asset, price, date }) => { asset.quote = price; asset.quoteDate = date; });
  out.updated = fetched.quotes.length;
  out.failed = fetched.failed;
  if (q.fx && hasUsdAssets()) {
    try { state.settings.fx.USD = { rate: await fetchUsd(), date: today() }; out.fx = true; }
    catch (err) { out.errors.push('dólar: ' + err.message); }
  }
  if (q.rates) {
    try {
      const r = await fetchRates(), R = state.settings.rates;
      if (r.cdi) R.cdi = r.cdi.v; if (r.selic) R.selic = r.selic.v; if (r.ipca) R.ipca = r.ipca.v;
      if (r.cdi || r.selic || r.ipca) { R.date = today(); out.rates = true; } else out.errors.push('indicadores indisponíveis');
    } catch (err) { out.errors.push('indicadores: ' + err.message); }
  }
  q.lastRun = new Date().toISOString(); savePrefs();
  if (out.updated || out.fx || out.rates) await persist();
  return out;
}
/** Execução automática ao abrir o app: no máximo a cada 1 hora. */
export function shouldAutoRun() {
  if (!prefs.quotes.auto || !quotesEnabled()) return false;
  const last = Date.parse(prefs.quotes.lastRun || 0);
  return !last || Date.now() - last > 1 * 3600e3;
}
export const summarize = r => {
  const parts = [];
  if (r.updated) parts.push(`${r.updated} cotação(ões)`);
  if (r.fx) parts.push('dólar');
  if (r.rates) parts.push('indicadores');
  let msg = parts.length ? `Atualizado: ${parts.join(', ')}.` : 'Nada foi atualizado.';
  if (r.failed.length) msg += ` Falharam: ${r.failed.slice(0, 5).join(', ')}${r.failed.length > 5 ? '…' : ''}.`;
  if (r.errors.length) msg += ` (${r.errors.join('; ')})`;
  return msg;
};
