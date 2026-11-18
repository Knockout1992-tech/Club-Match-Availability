
const CACHE_NAME = "club-check-in-v1123-policy-link-fix";

const APP_SHELL = [
    "./",
    "./manifest.json",
    "./icons/icon.svg"
];

// Install =========================================

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

// Activate ========================================

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key =>
                        key.startsWith("club-check-in-") &&
                        key !== CACHE_NAME
                    )
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// Network First — Bypass Browser Cache ============

self.addEventListener("fetch", event => {
    const request = event.request;
    const url = new URL(request.url);
    const scope = new URL(self.registration.scope);

    if (
        request.method !== "GET" ||
        url.origin !== scope.origin ||
        !url.pathname.startsWith(scope.pathname) ||
        url.pathname.endsWith("/service-worker.js")
    ) {
        return;
    }

    event.respondWith(
        fetch(new Request(request, {
            cache: "no-store"
        }))
            .then(async response => {

                if (response.ok && response.type === "basic") {
                    const cache = await caches.open(CACHE_NAME);

                    await cache.put(
                        request,
                        response.clone()
                    );
                }

                return response;
            })
            .catch(async () => {

                const cachedResponse =
                    await caches.match(request);

                if (cachedResponse) {
                    return cachedResponse;
                }

                if (request.mode === "navigate") {
                    return await caches.match("./") ||
                        new Response("Offline", {
                            status: 503
                        });
                }

                return new Response("Offline", {
                    status: 503
                });
            })
    );
});
