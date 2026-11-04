import "server-only";
import webpush from "web-push";
import type { UserRole } from "@/contracts/domain";
import { getServerEnv } from "@/lib/env/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export interface PushNotificationPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

interface StoredPushSubscriptionRow {
  id?: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function getConfiguredVapidOptions(): webpush.RequestOptions | null {
  try {
    const env = getServerEnv();
    const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY.trim();
    const privateKey = env.VAPID_PRIVATE_KEY.trim();
    const subject = env.VAPID_SUBJECT.trim() || "mailto:soporte@pedidosflash.local";

    if (!publicKey || !privateKey) {
      return null;
    }

    return {
      vapidDetails: {
        subject,
        publicKey,
        privateKey,
      },
      TTL: 120,
    };
  } catch {
    return null;
  }
}

function extractWebPushStatusCode(reason: unknown): number | null {
  if (
    reason &&
    typeof reason === "object" &&
    "statusCode" in reason &&
    typeof (reason as { statusCode?: unknown }).statusCode === "number"
  ) {
    return (reason as { statusCode: number }).statusCode;
  }
  return null;
}

/**
 * Envía notificaciones Web Push a un conjunto de usuarios específicos.
 * Degrada silenciosamente si no hay claves VAPID configuradas o si no existen suscripciones.
 */
export async function sendPushToUsers(
  userIds: readonly string[],
  payload: PushNotificationPayload
): Promise<void> {
  try {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueUserIds.length === 0) return;

    const vapidOptions = getConfiguredVapidOptions();
    if (!vapidOptions) return;

    const supabaseAdmin = createAdminSupabaseClient();
    const { data: rows, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("user_id, endpoint, p256dh, auth")
      .in("user_id", uniqueUserIds);

    if (error || !rows || rows.length === 0) {
      return;
    }

    const serializedPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url,
      tag: payload.tag ?? "pedidos-flash",
      timestamp: Date.now(),
    });

    const staleEndpoints: string[] = [];

    const typedRows = rows as StoredPushSubscriptionRow[];
    const results = await Promise.allSettled(
      typedRows.map(async (sub) => {
        if (!sub.endpoint || !sub.p256dh || !sub.auth) return;
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          serializedPayload,
          vapidOptions
        );
      })
    );

    results.forEach((res, index) => {
      if (res.status === "rejected") {
        const statusCode = extractWebPushStatusCode(res.reason);
        const sub = typedRows[index];
        if ((statusCode === 404 || statusCode === 410) && sub?.endpoint) {
          staleEndpoints.push(sub.endpoint);
        }
      }
    });

    if (staleEndpoints.length > 0) {
      await supabaseAdmin
        .from("push_subscriptions")
        .delete()
        .in("endpoint", staleEndpoints);
    }
  } catch {
    // Degradación silenciosa: Web Push nunca debe interrumpir ni abortar el flujo transaccional.
  }
}

/**
 * Envía notificaciones Web Push a todos los usuarios activos con alguno de los roles indicados.
 */
export async function sendPushToRoles(
  roles: readonly UserRole[],
  payload: PushNotificationPayload
): Promise<void> {
  try {
    if (roles.length === 0) return;

    const vapidOptions = getConfiguredVapidOptions();
    if (!vapidOptions) return;

    const supabaseAdmin = createAdminSupabaseClient();
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .in("role", [...roles])
      .eq("is_active", true);

    if (error || !profiles || profiles.length === 0) {
      return;
    }

    const targetIds = profiles
      .map((p) => (typeof p.id === "string" ? p.id : ""))
      .filter(Boolean);

    await sendPushToUsers(targetIds, payload);
  } catch {
    // Degradación silenciosa
  }
}

export async function notifyKitchenNewComanda(params: {
  comandaNumber: number;
  tableCode: string;
  itemsCount: number;
  comandaType?: string;
}): Promise<void> {
  const typePrefix =
    params.comandaType === "adicion"
      ? "Adición"
      : params.comandaType === "correccion"
        ? "Corrección"
        : "Nueva comanda";

  await sendPushToRoles(["cocina"], {
    title: `${typePrefix} #${params.comandaNumber} — Mesa ${params.tableCode}`,
    body: `${params.itemsCount} producto(s) enviados a cocina.`,
    url: "/cocina",
    tag: `kds-comanda-${params.comandaNumber}`,
  });
}

export async function notifyWaiterComandaReady(params: {
  waiterId: string;
  comandaNumber: number;
  tableCode: string;
}): Promise<void> {
  await sendPushToUsers([params.waiterId], {
    title: `¡Pedido listo! Mesa ${params.tableCode}`,
    body: `La comanda #${params.comandaNumber} está lista para entregar.`,
    url: "/mozo",
    tag: `ready-comanda-${params.comandaNumber}`,
  });
}
