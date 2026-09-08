/* Trailbound service worker.
 *
 * Network-first with a cache fallback. Deliberately not precache-first: during
 * active development a stale precache is far more painful than a slightly
 * slower load, and the game is small enough that the network path is quick.
 * The cache exists so the app still opens on a walk with no signal.
 */

const CACHE = 'trailbound-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        // A navigation with nothing cached still needs a document.
        if (request.mode === 'navigate') {
          const shell = await caches.match('index.html')
          if (shell) return shell
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' })
      }),
  )
})
