/* eslint-disable no-restricted-globals */
/**
 * Service Worker Seguro de Pedidos Flash ("De la mesa a la cocina, en un flash.")
 *
 * Política estricta de seguridad de caché (Allowlist):
 * - NUNCA intercepta ni cachea peticiones a Supabase, `/api/*`, `/auth/*`, Server Actions, RSC ni HTML autenticado.
 * - Precachea únicamente el shell offline neutral (`/offline.html`) e íconos públicos de marca.
 * - Gestiona notificaciones Web Push estándar (VAPID) y enfoque inteligente de ventanas por rol.
 */

const STATIC_CACHE_NAME = "pf-static-v1";
const OFFLINE_FALLBACK_URL = "/offline.html";

const PRECACHE_REQUIRED = [OFFLINE_FALLBACK_URL, "/icons/favicon.svg", "/icons/logo-mark.svg"];
const PRECACHE_OPTIONAL = [
  "/manifest.webmanifest",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
  "/icons/icon-maskable-512x512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE_NAME);
      await cache.addAll(PRECACHE_REQUIRED);
      await Promise.allSettled(
        PRECACHE_OPTIONAL.map((assetUrl) => cache.add(assetUrl))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const existingNames = await caches.keys();
      await Promise.all(
        existingNames
          .filter((name) => name.startsWith("pf-") && name !== STATIC_CACHE_NAME)
          .map((staleName) => caches.delete(staleName))
      );
      await self.clients.claim();
    })()
  );
});

function isCacheableResponse(response) {
  if (!response || !response.ok || response.type !== "basic") {
    return false;
  }
  const cacheControl = (response.headers.get("Cache-Control") || "").toLowerCase();
  if (cacheControl.includes("no-store") || cacheControl.includes("private")) {
    return false;
  }
  if (response.headers.has("Set-Cookie")) {
    return false;
  }
  return true;
}

function shouldBypassRequest(request, url) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;

  const pathname = url.pathname;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/auth/") ||
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname.startsWith("/_next/webpack-hmr") ||
    pathname.includes("hot-update")
  ) {
    return true;
  }

  if (
    request.headers.has("Next-Action") ||
    request.headers.get("RSC") === "1" ||
    url.searchParams.has("_rsc")
  ) {
    return true;
  }

  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (shouldBypassRequest(request, url)) {
    return;
  }

  // 1. Navegación HTML: Network-Only estricto (jamás guardar HTML autenticado en CacheStorage)
  //    con fallback exclusivo a /offline.html cuando el dispositivo pierde toda conectividad.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(STATIC_CACHE_NAME);
          const offlinePage = await cache.match(OFFLINE_FALLBACK_URL);
          if (offlinePage) {
            return offlinePage;
          }
          return new Response(
            "<!doctype html><html lang='es'><meta charset='utf-8'><title>Sin conexión — Pedidos Flash</title><body style='background:#172033;color:#fff;font-family:sans-serif;padding:2rem;text-align:center'><h1>Pedidos Flash</h1><p>Sin conexión de red. Reintentá en unos segundos.</p></body></html>",
            {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }
          );
        }
      })()
    );
    return;
  }

  // 2. Bundles estáticos versionados de Next.js (`/_next/static/*`): Cache-First
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }
        const networkResponse = await fetch(request);
        if (isCacheableResponse(networkResponse)) {
          void cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      })()
    );
    return;
  }

  // 3. Íconos PWA y Manifest público: Stale-While-Revalidate
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === OFFLINE_FALLBACK_URL
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE_NAME);
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((response) => {
            if (isCacheableResponse(response)) {
              void cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          return cached;
        }
        const fresh = await networkPromise;
        return fresh || Response.error();
      })()
    );
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = {
        title: "Pedidos Flash",
        body: "Tenés una actualización operativa pendiente.",
        tag: "pf-general",
        url: "/",
        icon: "/icons/icon-192x192.png",
        badge: "/icons/favicon.svg",
        alwaysShow: false,
      };

      if (event.data) {
        try {
          const parsed = event.data.json();
          if (parsed && typeof parsed === "object") {
            payload = {
              ...payload,
              ...parsed,
            };
          }
        } catch {
          const fallbackText = event.data.text();
          if (fallbackText) {
            payload.body = fallbackText;
          }
        }
      }

      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      let hasFocusedVisibleClient = false;
      for (const client of windowClients) {
        client.postMessage({
          type: "PF_SW_PUSH_EVENT",
          payload,
        });
        if (client.focused && client.visibilityState === "visible") {
          hasFocusedVisibleClient = true;
        }
      }

      if (!hasFocusedVisibleClient || payload.alwaysShow) {
        await self.registration.showNotification(payload.title, {
          body: payload.body,
          icon: payload.icon || "/icons/icon-192x192.png",
          badge: payload.badge || "/icons/favicon.svg",
          tag: payload.tag || "pf-general",
          renotify: true,
          vibrate: [160, 80, 180],
          data: {
            url: payload.url || "/",
          },
        });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const rawUrl =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/";

  let targetUrl;
  try {
    const candidate = new URL(rawUrl, self.location.origin);
    targetUrl =
      candidate.origin === self.location.origin
        ? candidate.href
        : self.location.origin + "/";
  } catch {
    targetUrl = self.location.origin + "/";
  }

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        if (new URL(client.url).origin === self.location.origin) {
          if ("focus" in client) {
            await client.focus();
          }
          if ("navigate" in client && client.url !== targetUrl) {
            try {
              await client.navigate(targetUrl);
            } catch {
              // Ignorar si la navegación está en curso
            }
          }
          client.postMessage({
            type: "PF_SW_NOTIFICATION_CLICK",
            url: targetUrl,
          });
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "PF_SKIP_WAITING") {
    void self.skipWaiting();
    return;
  }

  if (data.type === "PF_SESSION_LOGOUT") {
    event.waitUntil(
      self.registration.getNotifications().then((notifications) => {
        for (const notification of notifications) {
          notification.close();
        }
      })
    );
  }
});
