import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMANDA_STATUSES,
  COMANDA_TYPES,
  SESSION_STATUSES,
  TABLE_STATUSES,
  type Category,
  type Comanda,
  type ComandaItem,
  type ComandaStatus,
  type ComandaType,
  type DiningTable,
  type FloorTableView,
  type KdsQueueComanda,
  type Payment,
  type PaymentMethod,
  type Product,
  type RestaurantSettings,
  type Sector,
  type SessionStatus,
  type TableSessionDetail,
  type TableStatus,
} from "@/contracts/domain";
import { CURRENCY_CODES, CURRENCY_CONFIG, type CurrencyCode } from "@/contracts/money";

type DbRow = Record<string, unknown>;

function toNumber(val: unknown, fallback = 0): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim() !== "") {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toInt(val: unknown, fallback = 0): number {
  return Math.round(toNumber(val, fallback));
}

function toStringOrEmpty(val: unknown): string {
  return typeof val === "string" ? val : "";
}

function toNullableString(val: unknown): string | null {
  return typeof val === "string" ? val : null;
}

export function normalizeCurrencyCode(val: unknown): CurrencyCode {
  if (typeof val === "string" && (CURRENCY_CODES as readonly string[]).includes(val)) {
    return val as CurrencyCode;
  }
  return "PYG";
}

function normalizeTableStatus(val: unknown): TableStatus {
  if (typeof val === "string" && (TABLE_STATUSES as readonly string[]).includes(val)) {
    return val as TableStatus;
  }
  return "libre";
}

function normalizeSessionStatus(val: unknown): SessionStatus {
  if (typeof val === "string" && (SESSION_STATUSES as readonly string[]).includes(val)) {
    return val as SessionStatus;
  }
  return "abierta";
}

function normalizeComandaStatus(val: unknown): ComandaStatus {
  if (typeof val === "string" && (COMANDA_STATUSES as readonly string[]).includes(val)) {
    return val as ComandaStatus;
  }
  return "nuevo";
}

function normalizeComandaType(val: unknown): ComandaType {
  if (typeof val === "string" && (COMANDA_TYPES as readonly string[]).includes(val)) {
    return val as ComandaType;
  }
  return "original";
}

export const DEFAULT_RESTAURANT_SETTINGS: RestaurantSettings = {
  id: 1,
  business_name: "Pedidos Flash",
  slogan: "De la mesa a la cocina, en un flash.",
  currency_code: "PYG",
  currency_decimals: 0,
  tax_percentage: 10,
  kds_warn_minutes: 8,
  kds_critical_minutes: 15,
  sound_alerts_default: true,
  updated_at: new Date(0).toISOString(),
};

export function mapRestaurantSettings(row?: DbRow | null): RestaurantSettings {
  if (!row) return { ...DEFAULT_RESTAURANT_SETTINGS };
  const currencyCode = normalizeCurrencyCode(row.currency_code);
  return {
    id: toInt(row.id, 1),
    business_name: toStringOrEmpty(row.business_name) || DEFAULT_RESTAURANT_SETTINGS.business_name,
    slogan: toStringOrEmpty(row.slogan) || DEFAULT_RESTAURANT_SETTINGS.slogan,
    currency_code: currencyCode,
    currency_decimals: toInt(
      row.currency_decimals,
      CURRENCY_CONFIG[currencyCode].decimals
    ),
    tax_percentage: toNumber(row.tax_percentage, 10),
    kds_warn_minutes: toInt(row.kds_warn_minutes, 8),
    kds_critical_minutes: toInt(row.kds_critical_minutes, 15),
    sound_alerts_default:
      typeof row.sound_alerts_default === "boolean" ? row.sound_alerts_default : true,
    updated_at: toStringOrEmpty(row.updated_at) || new Date().toISOString(),
  };
}

export function mapSector(row: DbRow): Sector {
  return {
    id: toStringOrEmpty(row.id),
    name: toStringOrEmpty(row.name),
    sort_order: toInt(row.sort_order, 0),
    is_active: row.is_active !== false,
  };
}

export function mapDiningTable(row: DbRow): DiningTable {
  return {
    id: toStringOrEmpty(row.id),
    code: toStringOrEmpty(row.code),
    name: toStringOrEmpty(row.name),
    sector_id: toStringOrEmpty(row.sector_id),
    capacity: toInt(row.capacity, 4),
    status: normalizeTableStatus(row.status),
    current_session_id: toNullableString(row.current_session_id),
    sort_order: toInt(row.sort_order, 0),
    is_active: row.is_active !== false,
  };
}

export function mapFloorTableView(row: DbRow): FloorTableView {
  const base = mapDiningTable(row);
  const totalAmount = toInt(row.total_amount, 0);
  const paidAmount = toInt(row.paid_amount, 0);
  const balanceDue =
    row.balance_due !== undefined && row.balance_due !== null
      ? toInt(row.balance_due, 0)
      : Math.max(0, totalAmount - paidAmount);

  return {
    ...base,
    sector_name: toStringOrEmpty(row.sector_name),
    session_number:
      row.session_number !== null && row.session_number !== undefined
        ? toInt(row.session_number)
        : null,
    session_opened_at: toNullableString(row.session_opened_at),
    opened_by_name: toNullableString(row.opened_by_name),
    total_amount: totalAmount,
    paid_amount: paidAmount,
    balance_due: balanceDue,
    active_comandas_count: toInt(row.active_comandas_count, 0),
    ready_comandas_count: toInt(row.ready_comandas_count, 0),
  };
}

export function mapCategory(row: DbRow): Category {
  return {
    id: toStringOrEmpty(row.id),
    name: toStringOrEmpty(row.name),
    slug: toStringOrEmpty(row.slug),
    sort_order: toInt(row.sort_order, 0),
    is_active: row.is_active !== false,
  };
}

export function mapProduct(row: DbRow): Product {
  const createdAt = toStringOrEmpty(row.created_at) || new Date().toISOString();
  return {
    id: toStringOrEmpty(row.id),
    category_id: toStringOrEmpty(row.category_id),
    name: toStringOrEmpty(row.name),
    description: toNullableString(row.description),
    price_amount: toInt(row.price_amount, 0),
    image_url: toNullableString(row.image_url),
    is_available: row.is_available !== false,
    is_active: row.is_active !== false,
    created_at: createdAt,
    updated_at: toStringOrEmpty(row.updated_at) || createdAt,
  };
}

export function mapComandaItem(row: DbRow): ComandaItem {
  const unitPrice = toInt(row.unit_price_snapshot, 0);
  const quantity = toInt(row.quantity, 1);
  const subtotal =
    row.subtotal !== undefined && row.subtotal !== null
      ? toInt(row.subtotal, unitPrice * quantity)
      : unitPrice * quantity;

  return {
    id: toStringOrEmpty(row.id),
    comanda_id: toStringOrEmpty(row.comanda_id),
    product_id: toStringOrEmpty(row.product_id),
    product_name_snapshot: toStringOrEmpty(row.product_name_snapshot),
    unit_price_snapshot: unitPrice,
    quantity,
    special_instructions: toNullableString(row.special_instructions),
    subtotal,
  };
}

export function mapComanda(row: DbRow): Comanda {
  return {
    id: toStringOrEmpty(row.id),
    comanda_number: toInt(row.comanda_number, 0),
    table_session_id: toStringOrEmpty(row.table_session_id),
    table_id: toStringOrEmpty(row.table_id),
    created_by: toStringOrEmpty(row.created_by),
    status: normalizeComandaStatus(row.status),
    comanda_type: normalizeComandaType(row.comanda_type),
    parent_comanda_id: toNullableString(row.parent_comanda_id),
    idempotency_key: toStringOrEmpty(row.idempotency_key),
    notes: toNullableString(row.notes),
    version: toInt(row.version, 1),
    created_at: toStringOrEmpty(row.created_at) || new Date().toISOString(),
    received_at: toNullableString(row.received_at),
    preparing_at: toNullableString(row.preparing_at),
    ready_at: toNullableString(row.ready_at),
    delivered_at: toNullableString(row.delivered_at),
  };
}

export function mapKdsQueueComanda(
  row: DbRow,
  fallbackItems?: ComandaItem[]
): KdsQueueComanda {
  const base = mapComanda(row);
  let items: ComandaItem[] = [];

  if (Array.isArray(row.items)) {
    items = row.items
      .filter((item): item is DbRow => Boolean(item && typeof item === "object"))
      .map((item) => mapComandaItem(item));
  } else if (fallbackItems) {
    items = fallbackItems;
  }

  return {
    ...base,
    table_code: toStringOrEmpty(row.table_code),
    sector_name: toStringOrEmpty(row.sector_name),
    waiter_name: toStringOrEmpty(row.waiter_name),
    items,
  };
}

export function mapPaymentMethod(row: DbRow): PaymentMethod {
  return {
    id: toStringOrEmpty(row.id),
    code: toStringOrEmpty(row.code),
    name: toStringOrEmpty(row.name),
    requires_reference: Boolean(row.requires_reference),
    is_cash: Boolean(row.is_cash),
    is_active: row.is_active !== false,
    sort_order: toInt(row.sort_order, 0),
  };
}

export function mapPayment(
  row: DbRow,
  enrichment?: { paymentMethodName?: string; cashierName?: string }
): Payment {
  return {
    id: toStringOrEmpty(row.id),
    table_session_id: toStringOrEmpty(row.table_session_id),
    payment_method_id: toStringOrEmpty(row.payment_method_id),
    payment_method_name:
      enrichment?.paymentMethodName ??
      (typeof row.payment_method_name === "string" ? row.payment_method_name : undefined),
    amount: toInt(row.amount, 0),
    amount_tendered:
      row.amount_tendered !== null && row.amount_tendered !== undefined
        ? toInt(row.amount_tendered)
        : null,
    change_amount: toInt(row.change_amount, 0),
    currency_code: normalizeCurrencyCode(row.currency_code),
    reference_code: toNullableString(row.reference_code),
    idempotency_key: toStringOrEmpty(row.idempotency_key),
    cashier_id: toStringOrEmpty(row.cashier_id),
    cashier_name:
      enrichment?.cashierName ??
      (typeof row.cashier_name === "string" ? row.cashier_name : undefined),
    created_at: toStringOrEmpty(row.created_at) || new Date().toISOString(),
  };
}

export async function fetchRestaurantSettings(
  supabase: SupabaseClient
): Promise<RestaurantSettings> {
  const { data } = await supabase
    .from("restaurant_settings")
    .select("*")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  return mapRestaurantSettings((data as DbRow | null) ?? null);
}

/**
 * Hidrata en lote una lista de `table_sessions` con su mesa, sector, comandas,
 * ítems históricos, pagos y nombres de personal sin consultas N+1.
 */
export async function hydrateTableSessionDetails(
  supabase: SupabaseClient,
  sessionRows: DbRow[]
): Promise<TableSessionDetail[]> {
  if (sessionRows.length === 0) return [];

  const sessionIds = sessionRows
    .map((r) => toStringOrEmpty(r.id))
    .filter(Boolean);
  const tableIds = Array.from(
    new Set(sessionRows.map((r) => toStringOrEmpty(r.table_id)).filter(Boolean))
  );

  const [tablesRes, sectorsRes, comandasRes, paymentsRes, paymentMethodsRes] =
    await Promise.all([
      tableIds.length > 0
        ? supabase.from("dining_tables").select("*").in("id", tableIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      supabase.from("sectors").select("*"),
      supabase
        .from("comandas")
        .select("*")
        .in("table_session_id", sessionIds)
        .order("created_at", { ascending: true })
        .order("comanda_number", { ascending: true }),
      supabase
        .from("payments")
        .select("*")
        .in("table_session_id", sessionIds)
        .order("created_at", { ascending: true }),
      supabase.from("payment_methods").select("*"),
    ]);

  const rawTables = (tablesRes.data ?? []) as DbRow[];
  const rawSectors = (sectorsRes.data ?? []) as DbRow[];
  const rawComandas = (comandasRes.data ?? []) as DbRow[];
  const rawPayments = (paymentsRes.data ?? []) as DbRow[];
  const rawPaymentMethods = (paymentMethodsRes.data ?? []) as DbRow[];

  const comandaIds = rawComandas
    .map((c) => toStringOrEmpty(c.id))
    .filter(Boolean);

  const profileIds = Array.from(
    new Set(
      [
        ...sessionRows.map((s) => toStringOrEmpty(s.opened_by)),
        ...rawComandas.map((c) => toStringOrEmpty(c.created_by)),
        ...rawPayments.map((p) => toStringOrEmpty(p.cashier_id)),
      ].filter(Boolean)
    )
  );

  const [itemsRes, profilesRes] = await Promise.all([
    comandaIds.length > 0
      ? supabase
          .from("comanda_items")
          .select("*")
          .in("comanda_id", comandaIds)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as DbRow[] }),
    profileIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", profileIds)
      : Promise.resolve({ data: [] as DbRow[] }),
  ]);

  const rawItems = (itemsRes.data ?? []) as DbRow[];
  const rawProfiles = (profilesRes.data ?? []) as DbRow[];

  const sectorNameById = new Map<string, string>();
  for (const s of rawSectors) {
    sectorNameById.set(toStringOrEmpty(s.id), toStringOrEmpty(s.name));
  }

  const tableById = new Map<string, DiningTable>();
  for (const t of rawTables) {
    const mapped = mapDiningTable(t);
    tableById.set(mapped.id, mapped);
  }

  const profileNameById = new Map<string, string>();
  for (const p of rawProfiles) {
    profileNameById.set(toStringOrEmpty(p.id), toStringOrEmpty(p.full_name));
  }

  const paymentMethodNameById = new Map<string, string>();
  for (const pm of rawPaymentMethods) {
    paymentMethodNameById.set(toStringOrEmpty(pm.id), toStringOrEmpty(pm.name));
  }

  const itemsByComandaId = new Map<string, ComandaItem[]>();
  for (const itemRow of rawItems) {
    const mappedItem = mapComandaItem(itemRow);
    const list = itemsByComandaId.get(mappedItem.comanda_id) ?? [];
    list.push(mappedItem);
    itemsByComandaId.set(mappedItem.comanda_id, list);
  }

  const comandasBySessionId = new Map<
    string,
    Array<Comanda & { waiter_name?: string; items: ComandaItem[] }>
  >();
  for (const cRow of rawComandas) {
    const mappedComanda = mapComanda(cRow);
    const list = comandasBySessionId.get(mappedComanda.table_session_id) ?? [];
    list.push({
      ...mappedComanda,
      waiter_name: profileNameById.get(mappedComanda.created_by),
      items: itemsByComandaId.get(mappedComanda.id) ?? [],
    });
    comandasBySessionId.set(mappedComanda.table_session_id, list);
  }

  const paymentsBySessionId = new Map<string, Payment[]>();
  for (const pRow of rawPayments) {
    const pmId = toStringOrEmpty(pRow.payment_method_id);
    const cashierId = toStringOrEmpty(pRow.cashier_id);
    const mappedPayment = mapPayment(pRow, {
      paymentMethodName: paymentMethodNameById.get(pmId),
      cashierName: profileNameById.get(cashierId),
    });
    const list = paymentsBySessionId.get(mappedPayment.table_session_id) ?? [];
    list.push(mappedPayment);
    paymentsBySessionId.set(mappedPayment.table_session_id, list);
  }

  return sessionRows.map((sRow) => {
    const id = toStringOrEmpty(sRow.id);
    const tableId = toStringOrEmpty(sRow.table_id);
    const openedBy = toStringOrEmpty(sRow.opened_by);
    const table = tableById.get(tableId);
    const sectorName = table ? (sectorNameById.get(table.sector_id) ?? "") : "";
    const comandas = comandasBySessionId.get(id) ?? [];
    const payments = paymentsBySessionId.get(id) ?? [];

    const computedItemsSubtotal = comandas.reduce(
      (acc, c) =>
        acc + c.items.reduce((sum, item) => sum + item.subtotal, 0),
      0
    );
    const computedPaid = payments.reduce((acc, p) => acc + p.amount, 0);

    const subtotalAmount =
      sRow.subtotal_amount !== undefined && sRow.subtotal_amount !== null
        ? toInt(sRow.subtotal_amount, computedItemsSubtotal)
        : computedItemsSubtotal;
    const totalAmount =
      sRow.total_amount !== undefined && sRow.total_amount !== null
        ? toInt(sRow.total_amount, subtotalAmount)
        : subtotalAmount;
    const paidAmount =
      sRow.paid_amount !== undefined && sRow.paid_amount !== null
        ? toInt(sRow.paid_amount, computedPaid)
        : computedPaid;
    const balanceDue =
      sRow.balance_due !== undefined && sRow.balance_due !== null
        ? toInt(sRow.balance_due, Math.max(0, totalAmount - paidAmount))
        : Math.max(0, totalAmount - paidAmount);

    return {
      id,
      session_number: toInt(sRow.session_number, 0),
      table_id: tableId,
      table_code: table?.code ?? toStringOrEmpty(sRow.table_code),
      sector_name: sectorName,
      opened_by: openedBy,
      opened_by_name: profileNameById.get(openedBy) ?? "",
      status: normalizeSessionStatus(sRow.status),
      currency_code: normalizeCurrencyCode(sRow.currency_code),
      subtotal_amount: subtotalAmount,
      total_amount: totalAmount,
      paid_amount: paidAmount,
      balance_due: balanceDue,
      opened_at: toStringOrEmpty(sRow.opened_at) || new Date().toISOString(),
      closed_at: toNullableString(sRow.closed_at),
      comandas,
      payments,
    };
  });
}
