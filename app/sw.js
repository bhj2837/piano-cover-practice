// 앱 화면 파일을 폰에 담아 두고 인터넷 없이도 연다.
// 캐시에 있는 것을 먼저 보여 주고, 뒤에서 새 판을 받아 다음 실행 때 쓴다.
// 받을 때는 브라우저 HTTP 캐시를 건너뛴다. GitHub Pages 가 10분 캐시(max-age=600)를 걸어서,
// 안 건너뛰면 캐시 이름을 올려도 옛 app.js 가 새 캐시에 들어간다
const CACHE = 'pcp-v5';
const FILES = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    // 주소 뒤 ?share=… 는 떼고 담는다 (안 떼면 공유할 때마다 캐시에 한 벌씩 쌓인다). no-cache 는 서버에 바뀌었는지만 묻는다
    const url = new URL(e.request.url); url.search = '';
    const fresh = fetch(url, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(url, r.clone()); return r; });
    return hit || fresh;
  }));
});
