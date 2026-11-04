import "server-only";
import { z } from "zod";
import type {
  Category,
  DiningTable,
  FloorTableView,
  PaymentMethod,
  Product,
  RestaurantSettings,
  Sector,
  UserProfile,
} from "@/contracts/domain";
import type { CurrencyCode } from "@/contracts/money";
import { mapUserProfileRow, requireRoleWithClient } from "@/server/auth/session";
import {
  fetchRestaurantSettings,
  mapCategory,
  mapComanda,
  mapComandaItem,
  mapDiningTable,
  mapFloorTableView,
  mapPayment,
  mapPaymentMethod,
  mapProduct,
  mapSector,
} from "./_mappers";

export interface AdminDashboardData {
  profile: UserProfile;
  users: UserProfile[];
  sectors: Sector[];
  tables: DiningTable[];
  floorTables: FloorTableView[];
  categories: Category[];
  products: Product[];
  paymentMethods: PaymentMethod[];
  settings: RestaurantSettings;
}

export interface DailySalesPoint {
  date: string;
  totalSales: number;
  paymentsCount: number;
  tablesServed: number;
  ordersCount: number;
}

export interface TopProductReportRow {
  productId: string;
  productName: string;
  quantitySold: number;
  totalRevenue: number;
  ordersCount: number;
}

export interface WaiterSalesReportRow {
  waiterId: string;
  waiterName: string;
  tablesServed: number;
  ordersCount: number;
  totalSales: number;
}

export interface PaymentMethodReportRow {
  paymentMethodId: string;
  paymentMethodCode: string;
  paymentMethodName: string;
  transactionsCount: number;
  totalAmount: number;
  percentage: number;
}

export interface SalesReportSummary {
  totalRevenue: number;
  totalPaymentsCount: number;
  tablesServedCount: number;
  ordersCount: number;
  itemsSoldCount: number;
  averageTicket: number;
  currencyCode: CurrencyCode;
}

export interface SalesReportData {
  range: {
    fromDate: string;
    toDate: string;
    fromIso: string;
    toIso: string;
  };
  businessName: string;
  summary: SalesReportSummary;
  salesByDay: DailySalesPoint[];
  topProducts: TopProductReportRow[];
  salesByWaiter: WaiterSalesReportRow[];
  salesByPaymentMethod: PaymentMethodReportRow[];
}

const isoDayRegex = /^\d{4}-\d{2}-\d{2}$/;

const reportRangeSchema = z.object({
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
});

function formatUtcDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function normalizeReportDateRange(
  rawFrom?: string | null,
  rawTo?: string | null
): {
  fromDate: string;
  toDate: string;
  fromIso: string;
  toIso: string;
} {
  const parsed = reportRangeSchema.safeParse({
    fromDate: rawFrom ?? undefined,
    toDate: rawTo ?? undefined,
  });

  const now = new Date();
  const defaultTo = formatUtcDateOnly(now);
  const sevenDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const defaultFrom = formatUtcDateOnly(sevenDaysAgo);

  const candidateFrom = parsed.success ? parsed.data.fromDate : undefined;
  const candidateTo = parsed.success ? parsed.data.toDate : undefined;

  let fromDay = defaultFrom;
  let toDay = defaultTo;

  if (candidateFrom) {
    if (isoDayRegex.test(candidateFrom)) {
      fromDay = candidateFrom;
    } else {
      const d = new Date(candidateFrom);
      if (!Number.isNaN(d.getTime())) {
        fromDay = formatUtcDateOnly(d);
      }
    }
  }

  if (candidateTo) {
    if (isoDayRegex.test(candidateTo)) {
      toDay = candidateTo;
    } else {
      const d = new Date(candidateTo);
      if (!Number.isNaN(d.getTime())) {
        toDay = formatUtcDateOnly(d);
      }
    }
  }

  if (fromDay > toDay) {
    const tmp = fromDay;
    fromDay = toDay;
    toDay = tmp;
  }

  // Rango inclusivo cubriendo día completo (incluyendo desfase horario local UTC-3)
  const fromIso = `${fromDay}T00:00:00.000Z`;
  const endDateObj = new Date(`${toDay}T23:59:59.999Z`);
  // Extendemos 4 horas tras medianoche UTC para cubrir cierres nocturnos en horario de Paraguay (UTC-3/-4)
  const toIso = new Date(endDateObj.getTime() + 4 * 60 * 60 * 1000).toISOString();

  return {
    fromDate: fromDay,
    toDate: toDay,
    fromIso,
    toIso,
  };
}

/**
 * Datos completos de administración:
 * usuarios/perfiles, sectores, mesas, categorías, productos, métodos de pago y configuración.
 */
export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const { profile, supabase } = await requireRoleWithClient(["admin"]);

  const [
    usersRes,
    sectorsRes,
    tablesRes,
    floorTablesRes,
    categoriesRes,
    productsRes,
    paymentMethodsRes,
    settings,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, role, is_active, created_at, updated_at")
      .order("role", { ascending: true })
      .order("full_name", { ascending: true }),
    supabase
      .from("sectors")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("dining_tables")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true }),
    supabase
      .from("v_floor_tables")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true }),
    supabase
      .from("categories")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("products")
      .select("*")
      .order("name", { ascending: true }),
    supabase
      .from("payment_methods")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    fetchRestaurantSettings(supabase),
  ]);

  if (usersRes.error) {
    throw new Error(`Error al consultar usuarios: ${usersRes.error.message}`);
  }
  if (productsRes.error) {
    throw new Error(`Error al consultar productos: ${productsRes.error.message}`);
  }

  const users = ((usersRes.data ?? []) as Record<string, unknown>[])
    .map(mapUserProfileRow)
    .filter((u): u is UserProfile => u !== null);

  const sectors = ((sectorsRes.data ?? []) as Record<string, unknown>[]).map(
    mapSector
  );
  const tables = ((tablesRes.data ?? []) as Record<string, unknown>[]).map(
    mapDiningTable
  );
  const floorTables = (
    (floorTablesRes.data ?? []) as Record<string, unknown>[]
  ).map(mapFloorTableView);
  const categories = (
    (categoriesRes.data ?? []) as Record<string, unknown>[]
  ).map(mapCategory);
  const products = ((productsRes.data ?? []) as Record<string, unknown>[]).map(
    mapProduct
  );
  const paymentMethods = (
    (paymentMethodsRes.data ?? []) as Record<string, unknown>[]
  ).map(mapPaymentMethod);

  return {
    profile,
    users,
    sectors,
    tables,
    floorTables,
    categories,
    products,
    paymentMethods,
    settings,
  };
}

/**
 * Calcula los indicadores analíticos y reportes de ventas sobre pagos y sesiones cerradas confirmadas:
 * - Ventas por día/período
 * - Productos más vendidos (usando snapshots históricos de precio y nombre)
 * - Cantidad de pedidos y mesas atendidas
 * - Ventas por mozo
 * - Desglose por método de pago
 */
export async function getSalesReportData(
  fromDate?: string,
  toDate?: string
): Promise<SalesReportData> {
  const { supabase } = await requireRoleWithClient(["admin"]);
  const range = normalizeReportDateRange(fromDate, toDate);

  const [
    settings,
    paymentsRes,
    closedSessionsRes,
    paymentMethodsRes,
    profilesRes,
  ] = await Promise.all([
    fetchRestaurantSettings(supabase),
    supabase
      .from("payments")
      .select("*")
      .gte("created_at", range.fromIso)
      .lte("created_at", range.toIso)
      .order("created_at", { ascending: true }),
    supabase
      .from("table_sessions")
      .select("*")
      .eq("status", "cerrada")
      .gte("closed_at", range.fromIso)
      .lte("closed_at", range.toIso)
      .order("closed_at", { ascending: true }),
    supabase.from("payment_methods").select("*"),
    supabase.from("profiles").select("id, full_name"),
  ]);

  if (paymentsRes.error) {
    throw new Error(
      `Error al consultar pagos del reporte: ${paymentsRes.error.message}`
    );
  }
  if (closedSessionsRes.error) {
    throw new Error(
      `Error al consultar sesiones cerradas del reporte: ${closedSessionsRes.error.message}`
    );
  }

  const payments = ((paymentsRes.data ?? []) as Record<string, unknown>[]).map(
    (r) => mapPayment(r)
  );
  const closedSessionRows = (closedSessionsRes.data ?? []) as Record<
    string,
    unknown
  >[];
  const paymentMethods = (
    (paymentMethodsRes.data ?? []) as Record<string, unknown>[]
  ).map(mapPaymentMethod);

  const profileNameById = new Map<string, string>();
  for (const p of (profilesRes.data ?? []) as Record<string, unknown>[]) {
    if (typeof p.id === "string" && typeof p.full_name === "string") {
      profileNameById.set(p.id, p.full_name);
    }
  }

  const methodById = new Map<string, PaymentMethod>();
  for (const pm of paymentMethods) {
    methodById.set(pm.id, pm);
  }

  // Asegurar que también tengamos las sesiones asociadas a pagos confirmados del período
  const sessionById = new Map<string, Record<string, unknown>>();
  for (const s of closedSessionRows) {
    if (typeof s.id === "string") {
      sessionById.set(s.id, s);
    }
  }

  const missingPaidSessionIds = Array.from(
    new Set(
      payments
        .map((p) => p.table_session_id)
        .filter((id) => id && !sessionById.has(id))
    )
  );

  if (missingPaidSessionIds.length > 0) {
    const { data: extraSessions } = await supabase
      .from("table_sessions")
      .select("*")
      .in("id", missingPaidSessionIds)
      .eq("status", "cerrada");

    for (const s of (extraSessions ?? []) as Record<string, unknown>[]) {
      if (typeof s.id === "string") {
        sessionById.set(s.id, s);
      }
    }
  }

  const confirmedSessionIds = Array.from(sessionById.keys());

  // Cargar comandas e ítems históricos de las sesiones cerradas/confirmadas
  const comandasRes =
    confirmedSessionIds.length > 0
      ? await supabase
          .from("comandas")
          .select("*")
          .in("table_session_id", confirmedSessionIds)
      : { data: [] as Record<string, unknown>[] };

  const comandas = ((comandasRes.data ?? []) as Record<string, unknown>[]).map(
    mapComanda
  );
  const comandaIds = comandas.map((c) => c.id).filter(Boolean);

  const itemsRes =
    comandaIds.length > 0
      ? await supabase
          .from("comanda_items")
          .select("*")
          .in("comanda_id", comandaIds)
      : { data: [] as Record<string, unknown>[] };

  const items = ((itemsRes.data ?? []) as Record<string, unknown>[]).map(
    mapComandaItem
  );

  // 1. Resumen general y ventas por día
  const dayBuckets = new Map<
    string,
    {
      totalSales: number;
      paymentsCount: number;
      sessionIds: Set<string>;
      ordersCount: number;
    }
  >();

  const ensureDayBucket = (dayKey: string) => {
    let bucket = dayBuckets.get(dayKey);
    if (!bucket) {
      bucket = {
        totalSales: 0,
        paymentsCount: 0,
        sessionIds: new Set<string>(),
        ordersCount: 0,
      };
      dayBuckets.set(dayKey, bucket);
    }
    return bucket;
  };

  let totalRevenue = 0;

  for (const payment of payments) {
    const dayKey = payment.created_at.slice(0, 10);
    const bucket = ensureDayBucket(dayKey);
    bucket.totalSales += payment.amount;
    bucket.paymentsCount += 1;
    if (payment.table_session_id) {
      bucket.sessionIds.add(payment.table_session_id);
    }
    totalRevenue += payment.amount;
  }

  for (const session of sessionById.values()) {
    const sessionId = typeof session.id === "string" ? session.id : "";
    const closedAt =
      typeof session.closed_at === "string"
        ? session.closed_at
        : typeof session.opened_at === "string"
          ? session.opened_at
          : "";
    if (closedAt && sessionId) {
      const dayKey = closedAt.slice(0, 10);
      ensureDayBucket(dayKey).sessionIds.add(sessionId);
    }
  }

  for (const comanda of comandas) {
    const dayKey = comanda.created_at.slice(0, 10);
    ensureDayBucket(dayKey).ordersCount += 1;
  }

  const salesByDay: DailySalesPoint[] = Array.from(dayBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => ({
      date,
      totalSales: bucket.totalSales,
      paymentsCount: bucket.paymentsCount,
      tablesServed: bucket.sessionIds.size,
      ordersCount: bucket.ordersCount,
    }));

  // 2. Productos más vendidos (conservando precios históricos en comanda_items)
  const productAgg = new Map<
    string,
    {
      productId: string;
      productName: string;
      quantitySold: number;
      totalRevenue: number;
      comandaIds: Set<string>;
    }
  >();

  let itemsSoldCount = 0;

  for (const item of items) {
    itemsSoldCount += item.quantity;
    const key = item.product_id || item.product_name_snapshot;
    let entry = productAgg.get(key);
    if (!entry) {
      entry = {
        productId: item.product_id,
        productName: item.product_name_snapshot || "Producto",
        quantitySold: 0,
        totalRevenue: 0,
        comandaIds: new Set<string>(),
      };
      productAgg.set(key, entry);
    }
    entry.quantitySold += item.quantity;
    entry.totalRevenue += item.subtotal;
    entry.comandaIds.add(item.comanda_id);
  }

  const topProducts: TopProductReportRow[] = Array.from(productAgg.values())
    .map((p) => ({
      productId: p.productId,
      productName: p.productName,
      quantitySold: p.quantitySold,
      totalRevenue: p.totalRevenue,
      ordersCount: p.comandaIds.size,
    }))
    .sort(
      (a, b) =>
        b.quantitySold - a.quantitySold || b.totalRevenue - a.totalRevenue
    );

  // 3. Ventas por mozo
  const paidBySessionId = new Map<string, number>();
  for (const payment of payments) {
    paidBySessionId.set(
      payment.table_session_id,
      (paidBySessionId.get(payment.table_session_id) ?? 0) + payment.amount
    );
  }

  const waiterAgg = new Map<
    string,
    {
      waiterId: string;
      waiterName: string;
      sessionIds: Set<string>;
      ordersCount: number;
      totalSales: number;
    }
  >();

  const ensureWaiter = (waiterId: string) => {
    let entry = waiterAgg.get(waiterId);
    if (!entry) {
      entry = {
        waiterId,
        waiterName: profileNameById.get(waiterId) ?? "Personal",
        sessionIds: new Set<string>(),
        ordersCount: 0,
        totalSales: 0,
      };
      waiterAgg.set(waiterId, entry);
    }
    return entry;
  };

  for (const [sessionId, session] of sessionById.entries()) {
    const waiterId =
      typeof session.opened_by === "string" ? session.opened_by : "";
    if (!waiterId) continue;
    const entry = ensureWaiter(waiterId);
    entry.sessionIds.add(sessionId);

    const paidInPeriod = paidBySessionId.get(sessionId);
    const sessionPaidFallback =
      typeof session.paid_amount === "number"
        ? Math.round(session.paid_amount)
        : Number(session.paid_amount ?? 0) || 0;
    entry.totalSales += paidInPeriod ?? sessionPaidFallback;
  }

  for (const comanda of comandas) {
    if (!comanda.created_by) continue;
    const entry = ensureWaiter(comanda.created_by);
    entry.ordersCount += 1;
  }

  const salesByWaiter: WaiterSalesReportRow[] = Array.from(waiterAgg.values())
    .map((w) => ({
      waiterId: w.waiterId,
      waiterName: w.waiterName,
      tablesServed: w.sessionIds.size,
      ordersCount: w.ordersCount,
      totalSales: w.totalSales,
    }))
    .sort(
      (a, b) => b.totalSales - a.totalSales || b.tablesServed - a.tablesServed
    );

  // 4. Desglose por método de pago
  const methodAgg = new Map<
    string,
    {
      paymentMethodId: string;
      paymentMethodCode: string;
      paymentMethodName: string;
      transactionsCount: number;
      totalAmount: number;
    }
  >();

  for (const payment of payments) {
    const method = methodById.get(payment.payment_method_id);
    const key = payment.payment_method_id || "otro";
    let entry = methodAgg.get(key);
    if (!entry) {
      entry = {
        paymentMethodId: key,
        paymentMethodCode: method?.code ?? "otro",
        paymentMethodName: method?.name ?? "Otro método",
        transactionsCount: 0,
        totalAmount: 0,
      };
      methodAgg.set(key, entry);
    }
    entry.transactionsCount += 1;
    entry.totalAmount += payment.amount;
  }

  const salesByPaymentMethod: PaymentMethodReportRow[] = Array.from(
    methodAgg.values()
  )
    .map((m) => ({
      ...m,
      percentage:
        totalRevenue > 0
          ? Math.round((m.totalAmount / totalRevenue) * 10000) / 100
          : 0,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  const tablesServedCount = confirmedSessionIds.length;
  const ordersCount = comandas.length;
  const averageTicket =
    tablesServedCount > 0 ? Math.round(totalRevenue / tablesServedCount) : 0;

  return {
    range,
    businessName: settings.business_name,
    summary: {
      totalRevenue,
      totalPaymentsCount: payments.length,
      tablesServedCount,
      ordersCount,
      itemsSoldCount,
      averageTicket,
      currencyCode: settings.currency_code,
    },
    salesByDay,
    topProducts,
    salesByWaiter,
    salesByPaymentMethod,
  };
}
