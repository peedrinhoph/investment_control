/* Service worker do Patrimônio: funciona offline e avisa quando há nova versão.
   Ao publicar uma atualização, altere VERSION: o app mostra "Nova versão disponível". */
const VERSION = '4.0.1';
const CACHE = 'patrimonio-' + VERSION;
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './css/app.css',
  './js/main.js', './js/config.js', './js/utils.js', './js/prefs.js', './js/ui.js', './js/store.js', './js/finance.js',
  './js/planning.js', './js/tax.js', './js/charts.js', './js/crypto.js', './js/b3.js', './js/quotes.js', './js/forms.js', './js/data.js',
  './js/views/dashboard.js', './js/views/portfolio.js', './js/views/transactions.js', './js/views/income.js',
  './js/views/plan.js', './js/views/wealth.js', './js/views/reports.js'
];

self.addEventListener('install', event => {
  // Não ativa sozinho: espera o usuário tocar em "Atualizar agora".
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(SHELL.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)))));
});

self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('patrimonio-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Arquivos do app vêm do cache da versão instalada (consistência entre módulos);
  // o que não estiver no cache vai à rede e é guardado.
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') || await cache.match('./') : null);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === 'navigate') { const fb = await cache.match('./index.html'); if (fb) return fb; }
        throw err;
      }
    })
  );
});
