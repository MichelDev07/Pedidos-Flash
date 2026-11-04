import "server-only";
import { z } from "zod";
import type {
  Category,
  FloorTableView,
  Product,
  RestaurantSettings,
  Sector,
  TableSessionDetail,
  UserProfile,
} from "@/contracts/domain";
import { requireRoleWithClient } from "@/server/auth/session";
import {
  fetchRestaurantSettings,
  hydrateTableSessionDetails,
  mapCategory,
  mapFloorTableView,
  mapProduct,
  mapSector,
} from "./_mappers";

const uuidSchema = z.string().uuid();

export interface FloorDashboardData {
  profile: UserProfile;
  sectors: Sector[];
  tables: FloorTableView[];
  settings: RestaurantSettings;
}

export interface TableWorkspaceData {
  profile: UserProfile;
  table: FloorTableView;
  session: TableSessionDetail | null;
  categories: Category[];
  products: Product[];
  settings: RestaurantSettings;
}

/**
 * Datos principales del salón para Mozo / Admin:
 * sectores activos, vista de mesas en tiempo real (`v_floor_tables`) y configuración.
 */
export async function getFloorDashboardData(): Promise<FloorDashboardData> {
  const { profile, supabase } = await requireRoleWithClient([
    "mozo",
    "caja",
    "admin",
  ]);

  const [sectorsRes, tablesRes, settings] = await Promise.all([
    supabase
      .from("sectors")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("v_floor_tables")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true }),
    fetchRestaurantSettings(supabase),
  ]);

  if (sectorsRes.error) {
    throw new Error(`Error al consultar sectores: ${sectorsRes.error.message}`);
  }
  if (tablesRes.error) {
    throw new Error(`Error al consultar mesas del salón: ${tablesRes.error.message}`);
  }

  const sectors = ((sectorsRes.data ?? []) as Record<string, unknown>[]).map(
    mapSector
  );
  const tables = ((tablesRes.data ?? []) as Record<string, unknown>[]).map(
    mapFloorTableView
  );

  return {
    profile,
    sectors,
    tables,
    settings,
  };
}

/**
 * Obtiene el detalle completo de una sesión de mesa por `sessionId`
 * (comandas ordenadas con ítems y snapshots históricos + pagos registrados).
 */
export async function getTableSessionDetail(
  sessionId: string
): Promise<TableSessionDetail | null> {
  const parsedId = uuidSchema.safeParse(sessionId);
  if (!parsedId.success) return null;

  const { supabase } = await requireRoleWithClient(["mozo", "caja", "admin"]);

  const { data: sessionRow, error } = await supabase
    .from("table_sessions")
    .select("*")
    .eq("id", parsedId.data)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al consultar sesión de mesa: ${error.message}`);
  }
  if (!sessionRow) {
    return null;
  }

  const details = await hydrateTableSessionDetails(supabase, [
    sessionRow as Record<string, unknown>,
  ]);

  return details[0] ?? null;
}

/**
 * Obtiene el espacio de trabajo completo de toma de pedido por `tableId`:
 * mesa del salón, sesión activa (si existe) con comandas/ítems/pagos,
 * catálogo de categorías y productos activos, y configuración del restaurante.
 */
export async function getTableWorkspaceByTableId(
  tableId: string
): Promise<TableWorkspaceData | null> {
  const parsedId = uuidSchema.safeParse(tableId);
  if (!parsedId.success) return null;

  const { profile, supabase } = await requireRoleWithClient([
    "mozo",
    "caja",
    "admin",
  ]);

  const [tableRes, categoriesRes, productsRes, settings] = await Promise.all([
    supabase
      .from("v_floor_tables")
      .select("*")
      .eq("id", parsedId.data)
      .maybeSingle(),
    supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    fetchRestaurantSettings(supabase),
  ]);

  if (tableRes.error || !tableRes.data) {
    return null;
  }

  const table = mapFloorTableView(tableRes.data as Record<string, unknown>);
  const categories = ((categoriesRes.data ?? []) as Record<string, unknown>[]).map(
    mapCategory
  );
  const products = ((productsRes.data ?? []) as Record<string, unknown>[]).map(
    mapProduct
  );

  let session: TableSessionDetail | null = null;

  if (table.current_session_id) {
    const { data: sessionRow } = await supabase
      .from("table_sessions")
      .select("*")
      .eq("id", table.current_session_id)
      .maybeSingle();

    if (sessionRow) {
      const hydrated = await hydrateTableSessionDetails(supabase, [
        sessionRow as Record<string, unknown>,
      ]);
      session = hydrated[0] ?? null;
    }
  } else {
    const { data: activeSessionRow } = await supabase
      .from("table_sessions")
      .select("*")
      .eq("table_id", table.id)
      .in("status", ["abierta", "pendiente_cobro"])
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeSessionRow) {
      const hydrated = await hydrateTableSessionDetails(supabase, [
        activeSessionRow as Record<string, unknown>,
      ]);
      session = hydrated[0] ?? null;
    }
  }

  return {
    profile,
    table,
    session,
    categories,
    products,
    settings,
  };
}

/**
 * Variante por `sessionId` que incluye catálogo activo + sesión hidratada + mesa.
 */
export async function getTableWorkspaceBySessionId(
  sessionId: string
): Promise<TableWorkspaceData | null> {
  const session = await getTableSessionDetail(sessionId);
  if (!session) return null;
  const workspace = await getTableWorkspaceByTableId(session.table_id);
  if (!workspace) return null;
  return {
    ...workspace,
    session,
  };
}
