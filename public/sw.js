const CACHE = "servicepro-shell-v1";
const SHELL = ["/offline", "/manifest.webmanifest", "/mark.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline")));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      return response;
    })));
  }
});

self.addEventListener("push", (event) => {
  let payload = { title: "ServicePro", body: "You have an update", url: "/tech" };
  try { payload = { ...payload, ...(event.data ? event.data.json() : {}) }; } catch {}
  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body, icon: "/mark.svg", badge: "/mark.svg", data: { url: payload.url }, tag: payload.url }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/tech";
  // Reuse the open app window when there is one; opening a second copy of the
  // workspace loses whatever the technician had on screen.
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && "focus" in client) {
        return client.navigate ? client.navigate(target).then((c) => (c || client).focus()) : client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});

// A push subscription can be rotated or expired by the browser itself. Without
// this the device silently stops receiving notifications and the server keeps a
// dead endpoint on file, which is the failure mode the sender now cleans up
// from its side too (404/410 -> the row is deleted).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const previous = event.oldSubscription || null;
    let next = event.newSubscription || null;
    if (!next) {
      const applicationServerKey = previous?.options?.applicationServerKey;
      if (!applicationServerKey) return;
      next = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    }
    if (previous?.endpoint) {
      await fetch(`/api/devices/push?endpoint=${encodeURIComponent(previous.endpoint)}`, { method: "DELETE" }).catch(() => undefined);
    }
    await fetch("/api/devices/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...next.toJSON(), deviceName: "renewed subscription" }),
    }).catch(() => undefined);
  })());
});
