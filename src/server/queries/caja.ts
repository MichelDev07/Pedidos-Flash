import "server-only";
import type {
  FloorTableView,
  Payment,
  PaymentMethod,
  RestaurantSettings,
  TableSessionDetail,
  UserProfile,
} from "@/contracts/domain";
import { requireRoleWithClient } from "@/server/auth/session";
import {
  fetchRestaurantSettings,
  hydrateTableSessionDetails,
  mapFloorTableView,
  mapPayment,
  mapPaymentMethod,
} from "./_mappers";

export interface RecentPaymentRecord extends Payment {
  session_number: number | null;
  table_code: string | null;
}

export interface CajaDashboardData {
  profile: UserProfile;
  openSessions: TableSessionDetail[];
  activeTables: FloorTableView[];
  paymentMethods: PaymentMethod[];
  recentClosedSessions: TableSessionDetail[];
  recentPayments: RecentPaymentRecord[];
  settings: RestaurantSettings;
}

/**
 * Datos operativos de Caja:
 * mesas con sesión `abierta` o `pendiente_cobro` (priorizando `pendiente_cobro`),
 * detalle completo de consumo, métodos de pago activos e historial reciente de sesiones cerradas y pagos.
 */
export async function getCajaDashboardData(): Promise<CajaDashboardData> {
  const { profile, supabase } = await requireRoleWithClient(["caja", "admin"]);

  const [
    openSessionsRes,
    activeTablesRes,
    paymentMethodsRes,
    closedSessionsRes,
    recentPaymentsRes,
    settings,
  ] = await Promise.all([
    supabase
      .from("table_sessions")
      .select("*")
      .in("status", ["abierta", "pendiente_cobro"])
      .order("opened_at", { ascending: true }),
    supabase
      .from("v_floor_tables")
      .select("*")
      .eq("is_active", true)
      .in("status", ["ocupada", "pendiente_cobro"])
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true }),
    supabase
      .from("payment_methods")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("table_sessions")
      .select("*")
      .eq("status", "cerrada")
      .order("closed_at", { ascending: false })
      .limit(20),
    supabase
      .from("payments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30),
    fetchRestaurantSettings(supabase),
  ]);

  if (openSessionsRes.error) {
    throw new Error(
      `Error al consultar sesiones activas para caja: ${openSessionsRes.error.message}`
    );
  }
  if (paymentMethodsRes.error) {
    throw new Error(
      `Error al consultar métodos de pago: ${paymentMethodsRes.error.message}`
    );
  }

  const rawOpenSessions = (openSessionsRes.data ?? []) as Record<string, unknown>[];
  const rawClosedSessions = (closedSessionsRes.data ?? []) as Record<
    string,
    unknown
  >[];

  const [hydratedOpen, hydratedClosed] = await Promise.all([
    hydrateTableSessionDetails(supabase, rawOpenSessions),
    hydrateTableSessionDetails(supabase, rawClosedSessions),
  ]);

  // Ordenar poniendo primero las sesiones `pendiente_cobro` y luego `abierta` por antigüedad
  const openSessions = [...hydratedOpen].sort((a, b) => {
    if (a.status === "pendiente_cobro" && b.status !== "pendiente_cobro") {
      return -1;
    }
    if (a.status !== "pendiente_cobro" && b.status === "pendiente_cobro") {
      return 1;
    }
    return a.opened_at.localeCompare(b.opened_at);
  });

  const activeTables = (
    (activeTablesRes.data ?? []) as Record<string, unknown>[]
  ).map(mapFloorTableView);

  const paymentMethods = (
    (paymentMethodsRes.data ?? []) as Record<string, unknown>[]
  ).map(mapPaymentMethod);

  // Enriquecer historial reciente de pagos
  const rawRecentPayments = (recentPaymentsRes.data ?? []) as Record<
    string,
    unknown
  >[];
  const allKnownSessions = new Map<string, TableSessionDetail>();
  for (const s of [...hydratedOpen, ...hydratedClosed]) {
    allKnownSessions.set(s.id, s);
  }

  const missingSessionIds = Array.from(
    new Set(
      rawRecentPayments
        .map((p) =>
          typeof p.table_session_id === "string" ? p.table_session_id : ""
        )
        .filter((id) => id && !allKnownSessions.has(id))
    )
  );

  if (missingSessionIds.length > 0) {
    const { data: extraSessions } = await supabase
      .from("table_sessions")
      .select("*")
      .in("id", missingSessionIds);

    if (extraSessions && extraSessions.length > 0) {
      const hydratedExtra = await hydrateTableSessionDetails(
        supabase,
        extraSessions as Record<string, unknown>[]
      );
      for (const s of hydratedExtra) {
        allKnownSessions.set(s.id, s);
      }
    }
  }

  const cashierIds = Array.from(
    new Set(
      rawRecentPayments
        .map((p) => (typeof p.cashier_id === "string" ? p.cashier_id : ""))
        .filter(Boolean)
    )
  );

  const [allMethodsRes, cashiersRes] = await Promise.all([
    supabase.from("payment_methods").select("id, name"),
    cashierIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", cashierIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const methodNameMap = new Map<string, string>();
  for (const m of (allMethodsRes.data ?? []) as Record<string, unknown>[]) {
    if (typeof m.id === "string" && typeof m.name === "string") {
      methodNameMap.set(m.id, m.name);
    }
  }

  const cashierNameMap = new Map<string, string>();
  for (const c of (cashiersRes.data ?? []) as Record<string, unknown>[]) {
    if (typeof c.id === "string" && typeof c.full_name === "string") {
      cashierNameMap.set(c.id, c.full_name);
    }
  }

  const recentPayments: RecentPaymentRecord[] = rawRecentPayments.map((row) => {
    const pmId =
      typeof row.payment_method_id === "string" ? row.payment_method_id : "";
    const cashierId =
      typeof row.cashier_id === "string" ? row.cashier_id : "";
    const sessionId =
      typeof row.table_session_id === "string" ? row.table_session_id : "";
    const matchedSession = allKnownSessions.get(sessionId);

    const payment = mapPayment(row, {
      paymentMethodName: methodNameMap.get(pmId),
      cashierName: cashierNameMap.get(cashierId),
    });

    return {
      ...payment,
      session_number: matchedSession?.session_number ?? null,
      table_code: matchedSession?.table_code ?? null,
    };
  });

  return {
    profile,
    openSessions,
    activeTables,
    paymentMethods,
    recentClosedSessions: hydratedClosed,
    recentPayments,
    settings,
  };
}
