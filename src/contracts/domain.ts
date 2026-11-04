import type { CurrencyCode } from "./money";

export const USER_ROLES = ["admin", "mozo", "cocina", "caja"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  mozo: "Mozo",
  cocina: "Cocina",
  caja: "Caja",
};

export const ROLE_HOME_ROUTES: Record<UserRole, string> = {
  admin: "/admin",
  mozo: "/mozo",
  cocina: "/cocina",
  caja: "/caja",
};

/**
 * Matriz de rutas permitidas por rol (validada tanto en Middleware como en Server Components / Actions).
 * El Administrador puede inspeccionar todas las vistas operativas además de /admin.
 */
export function canRoleAccessPath(role: UserRole, pathname: string): boolean {
  if (role === "admin") return true;
  if (pathname.startsWith("/mozo")) return role === "mozo";
  if (pathname.startsWith("/cocina")) return role === "cocina";
  if (pathname.startsWith("/caja")) return role === "caja";
  if (pathname.startsWith("/admin")) return false;
  return true;
}

export const TABLE_STATUSES = ["libre", "ocupada", "pendiente_cobro"] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  pendiente_cobro: "Pendiente de cobro",
};

export const SESSION_STATUSES = ["abierta", "pendiente_cobro", "cerrada"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const COMANDA_STATUSES = [
  "nuevo",
  "recibido",
  "preparando",
  "listo",
  "entregado",
] as const;
export type ComandaStatus = (typeof COMANDA_STATUSES)[number];

export const COMANDA_STATUS_LABELS: Record<ComandaStatus, string> = {
  nuevo: "Nuevo",
  recibido: "Recibido",
  preparando: "Preparando",
  listo: "Listo",
  entregado: "Entregado",
};

export const COMANDA_TYPES = ["original", "adicion", "correccion"] as const;
export type ComandaType = (typeof COMANDA_TYPES)[number];

export const VALID_COMANDA_TRANSITIONS: Record<ComandaStatus, readonly ComandaStatus[]> = {
  nuevo: ["recibido", "preparando"],
  recibido: ["preparando", "listo"],
  preparando: ["listo"],
  listo: ["entregado"],
  entregado: [],
};

export function canTransitionComandaStatus(
  from: ComandaStatus,
  to: ComandaStatus,
  role: UserRole
): boolean {
  if (!VALID_COMANDA_TRANSITIONS[from].includes(to)) return false;
  if (to === "entregado") {
    return role === "mozo" || role === "cocina" || role === "admin";
  }
  return role === "cocina" || role === "admin";
}

export interface RestaurantSettings {
  id: number;
  business_name: string;
  slogan: string;
  currency_code: CurrencyCode;
  currency_decimals: number;
  tax_percentage: number;
  kds_warn_minutes: number;
  kds_critical_minutes: number;
  sound_alerts_default: boolean;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Sector {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface DiningTable {
  id: string;
  code: string;
  name: string;
  sector_id: string;
  capacity: number;
  status: TableStatus;
  current_session_id: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface FloorTableView extends DiningTable {
  sector_name: string;
  session_number: number | null;
  session_opened_at: string | null;
  opened_by_name: string | null;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  active_comandas_count: number;
  ready_comandas_count: number;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
}

export interface Product {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_amount: number;
  image_url: string | null;
  is_available: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ComandaItem {
  id: string;
  comanda_id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  special_instructions: string | null;
  subtotal: number;
}

export interface Comanda {
  id: string;
  comanda_number: number;
  table_session_id: string;
  table_id: string;
  created_by: string;
  status: ComandaStatus;
  comanda_type: ComandaType;
  parent_comanda_id: string | null;
  idempotency_key: string;
  notes: string | null;
  version: number;
  created_at: string;
  received_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
}

export interface KdsQueueComanda extends Comanda {
  table_code: string;
  sector_name: string;
  waiter_name: string;
  items: ComandaItem[];
}

export interface TableSessionDetail {
  id: string;
  session_number: number;
  table_id: string;
  table_code: string;
  sector_name: string;
  opened_by: string;
  opened_by_name: string;
  status: SessionStatus;
  currency_code: CurrencyCode;
  subtotal_amount: number;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  opened_at: string;
  closed_at: string | null;
  comandas: Array<Comanda & { waiter_name?: string; items: ComandaItem[] }>;
  payments: Payment[];
}

export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  requires_reference: boolean;
  is_cash: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface Payment {
  id: string;
  table_session_id: string;
  payment_method_id: string;
  payment_method_name?: string;
  amount: number;
  amount_tendered: number | null;
  change_amount: number;
  currency_code: CurrencyCode;
  reference_code: string | null;
  idempotency_key: string;
  cashier_id: string;
  cashier_name?: string;
  created_at: string;
}

export interface ActionResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}
