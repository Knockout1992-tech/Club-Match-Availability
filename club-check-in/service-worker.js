
const CACHE_NAME = "club-check-in-v1169-notification-deep-links";

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

// Push notifications =================================

self.addEventListener("push", event => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch (_) {
        payload = { body: event.data ? event.data.text() : "Open Club Check-In for updates." };
    }
    const title = payload.title || "Club Check-In";
    const options = {
        body: payload.body || "There is an update to your club calendar.",
        icon: "./icons/icon.svg",
        badge: "./icons/icon.svg",
        tag: payload.tag || "club-check-in-update",
        renotify: false,
        data: { url: payload.url || "./" }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    event.waitUntil((async () => {
        const target = new URL(event.notification.data?.url || "./", self.registration.scope);
        const scope = new URL(self.registration.scope);
        if (target.origin !== scope.origin || !target.pathname.startsWith(scope.pathname)) return;

        const list = await clients.matchAll({ type: "window", includeUncontrolled: true });
        const existing = list.find(client => client.url.startsWith(self.registration.scope));
        if (existing) {
            if ("focus" in existing) await existing.focus();
            if ("postMessage" in existing) {
                existing.postMessage({ type: "COACH_NOTIFICATION_OPEN", url: target.href });
            }
            return;
        }
        return clients.openWindow(target.href);
    })());
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
