"use client";

import { getClientEnv } from "@/lib/env/client";

export type PushSupportStatus =
  | "supported"
  | "unsupported"
  | "ios-install-required"
  | "missing-vapid-key";

export type BrowserNotificationPermission = NotificationPermission | "unsupported";

export interface SerializedPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent: string;
}

export interface SubscribeWebPushOptions {
  /** Endpoint opcional del servidor para persistir la suscripción VAPID (por defecto `/api/push/subscribe`) */
  syncEndpoint?: string | null;
}

export interface SubscribeWebPushResult {
  ok: boolean;
  status:
    | "subscribed"
    | "permission-only"
    | "denied"
    | "unsupported"
    | "ios-install-required"
    | "error";
  permission: BrowserNotificationPermission;
  subscription?: SerializedPushSubscription;
  error?: string;
}

export interface LocalBrowserNotificationInput {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Convierte una clave pública VAPID codificada en Base64 URL-safe a `Uint8Array<ArrayBuffer>`.
 */
export function urlBase64ToUint8Array(
  base64String: string
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData =
    typeof window !== "undefined"
      ? window.atob(base64)
      : Buffer.from(base64, "base64").toString("binary");

  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Detecta si la app corre instalada en modo PWA `standalone` (Android o iOS Pantalla de Inicio).
 */
export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const displayStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone =
    (window.navigator as NavigatorWithStandalone).standalone === true;
  return displayStandalone || iosStandalone;
}

/**
 * Detecta dispositivos iPhone / iPad (incluyendo iPadOS que reporta plataforma MacIntel táctil).
 */
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/**
 * Evalúa el nivel de soporte Web Push del dispositivo y entorno actual sin lanzar errores.
 */
export function getPushSupportStatus(): PushSupportStatus {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "unsupported";
  }

  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    return "unsupported";
  }

  if (isIosDevice() && !isStandalonePwa() && !("PushManager" in window)) {
    return "ios-install-required";
  }

  if (!("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }

  try {
    const { NEXT_PUBLIC_VAPID_PUBLIC_KEY } = getClientEnv();
    if (!NEXT_PUBLIC_VAPID_PUBLIC_KEY.trim()) {
      return "missing-vapid-key";
    }
  } catch {
    return "missing-vapid-key";
  }

  return "supported";
}

/**
 * Obtiene el estado actual del permiso de notificaciones del navegador.
 */
export function getNotificationPermissionState(): BrowserNotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Registra de forma idempotente y segura `/sw.js` cuando el navegador soporta Service Workers.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !window.isSecureContext ||
    !("serviceWorker" in navigator)
  ) {
    return null;
  }

  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      })
      .catch(() => {
        swRegistrationPromise = null;
        return null;
      });
  }

  return swRegistrationPromise;
}

/**
 * Solicita permiso de notificaciones al navegador tras un gesto explícito del usuario.
 */
export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch {
    return getNotificationPermissionState();
  }
}

function serializeSubscription(
  subscription: PushSubscription
): SerializedPushSubscription | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!subscription.endpoint || !p256dh || !auth) {
    return null;
  }

  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: {
      p256dh,
      auth,
    },
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };
}

/**
 * Suscribe el dispositivo actual a Web Push VAPID (cuando está configurado y soportado)
 * o habilita notificaciones locales del navegador con degradación elegante si no hay clave VAPID.
 */
export async function subscribeToWebPush(
  options?: SubscribeWebPushOptions
): Promise<SubscribeWebPushResult> {
  const support = getPushSupportStatus();
  if (support === "ios-install-required") {
    return {
      ok: false,
      status: "ios-install-required",
      permission: getNotificationPermissionState(),
      error:
        "En iPhone/iPad instalá primero Pedidos Flash en Pantalla de Inicio para recibir avisos Push.",
    };
  }

  const permission = await requestBrowserNotificationPermission();
  if (permission === "unsupported") {
    return {
      ok: false,
      status: "unsupported",
      permission,
      error: "Este navegador no soporta notificaciones del sistema.",
    };
  }
  if (permission !== "granted") {
    return {
      ok: false,
      status: "denied",
      permission,
      error: "Permiso de notificaciones no concedido en el navegador.",
    };
  }

  const registration = await registerServiceWorker();

  // Si no hay VAPID público configurado o PushManager no está disponible, degradamos con gracia
  // manteniendo habilitadas las notificaciones del navegador mientras la app está abierta.
  if (support !== "supported" || !registration?.pushManager) {
    return {
      ok: true,
      status: "permission-only",
      permission,
    };
  }

  try {
    const { NEXT_PUBLIC_VAPID_PUBLIC_KEY } = getClientEnv();
    let pushSub = await registration.pushManager.getSubscription();
    if (!pushSub) {
      pushSub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(NEXT_PUBLIC_VAPID_PUBLIC_KEY),
      });
    }

    const serialized = serializeSubscription(pushSub);
    if (!serialized) {
      return {
        ok: true,
        status: "permission-only",
        permission,
      };
    }

    const syncEndpoint =
      options?.syncEndpoint === undefined
        ? "/api/push/subscribe"
        : options.syncEndpoint;

    if (syncEndpoint) {
      try {
        await fetch(syncEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(serialized),
        });
      } catch {
        // Degradación limpia si el endpoint de sincronización aún no está disponible o no hay red
      }
    }

    return {
      ok: true,
      status: "subscribed",
      permission,
      subscription: serialized,
    };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      permission,
      error:
        err instanceof Error
          ? err.message
          : "No fue posible completar la suscripción Web Push.",
    };
  }
}

/**
 * Revoca la suscripción Web Push activa del navegador y limpia notificaciones del sistema
 * (recomendado al cerrar sesión en tablets o dispositivos compartidos del restaurante).
 */
export async function unsubscribeFromWebPush(
  syncEndpoint: string | null = "/api/push/subscribe"
): Promise<boolean> {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return false;

    registration.active?.postMessage({ type: "PF_SESSION_LOGOUT" });

    const subscription = await registration.pushManager?.getSubscription();
    if (!subscription) return true;

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();

    if (syncEndpoint) {
      try {
        await fetch(syncEndpoint, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ endpoint }),
        });
      } catch {
        // Ignorar fallos de red durante logout
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Muestra una notificación nativa del navegador si el usuario concedió permiso.
 * Prioriza `ServiceWorkerRegistration.showNotification` (requerido en Android Chrome)
 * y cae con gracia al constructor `Notification` en navegadores de escritorio.
 */
export async function showBrowserNotification(
  input: LocalBrowserNotificationInput
): Promise<boolean> {
  if (getNotificationPermissionState() !== "granted") {
    return false;
  }

  const options: NotificationOptions = {
    body: input.body,
    tag: input.tag,
    icon: "/icons/icon-192x192.png",
    badge: "/icons/favicon.svg",
    data: { url: input.url ?? "/" },
  };

  try {
    const registration = await registerServiceWorker();
    if (registration && typeof registration.showNotification === "function") {
      await registration.showNotification(input.title, options);
      return true;
    }
  } catch {
    // Continuar con fallback de escritorio
  }

  try {
    if (typeof Notification === "function") {
      const notification = new Notification(input.title, options);
      if (input.url) {
        notification.onclick = () => {
          window.focus();
        };
      }
      return true;
    }
  } catch {
    return false;
  }

  return false;
}
