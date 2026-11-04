import "server-only";
import type {
  Category,
  ComandaItem,
  KdsQueueComanda,
  Product,
  RestaurantSettings,
  UserProfile,
} from "@/contracts/domain";
import { requireRoleWithClient } from "@/server/auth/session";
import {
  fetchRestaurantSettings,
  mapCategory,
  mapComandaItem,
  mapKdsQueueComanda,
  mapProduct,
} from "./_mappers";

export interface KdsQueueData {
  profile: UserProfile;
  queue: KdsQueueComanda[];
  settings: RestaurantSettings;
  products: Product[];
  categories: Category[];
}

/**
 * Obtiene la cola operativa del KDS (`v_kds_queue`) ordenada por antigüedad (`created_at ASC`),
 * junto con `restaurant_settings` y el listado de productos activos para el toggle rápido de agotados.
 */
export async function getKdsQueueData(): Promise<KdsQueueData> {
  const { profile, supabase } = await requireRoleWithClient(["cocina", "admin"]);

  const [queueRes, settings, productsRes, categoriesRes] = await Promise.all([
    supabase
      .from("v_kds_queue")
      .select("*")
      .neq("status", "entregado")
      .order("created_at", { ascending: true })
      .order("comanda_number", { ascending: true }),
    fetchRestaurantSettings(supabase),
    supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  if (queueRes.error) {
    throw new Error(`Error al consultar cola de cocina: ${queueRes.error.message}`);
  }
  if (productsRes.error) {
    throw new Error(`Error al consultar productos para cocina: ${productsRes.error.message}`);
  }

  const rawQueue = (queueRes.data ?? []) as Record<string, unknown>[];

  // Si la vista ya incluye `items` como JSON array lo usamos directo;
  // en caso contrario hidratamos `comanda_items` en una sola consulta de respaldo.
  const missingItemsIds = rawQueue
    .filter((row) => !Array.isArray(row.items))
    .map((row) => (typeof row.id === "string" ? row.id : ""))
    .filter(Boolean);

  const fallbackItemsByComandaId = new Map<string, ComandaItem[]>();

  if (missingItemsIds.length > 0) {
    const { data: itemRows } = await supabase
      .from("comanda_items")
      .select("*")
      .in("comanda_id", missingItemsIds)
      .order("id", { ascending: true });

    for (const rawItem of (itemRows ?? []) as Record<string, unknown>[]) {
      const item = mapComandaItem(rawItem);
      const list = fallbackItemsByComandaId.get(item.comanda_id) ?? [];
      list.push(item);
      fallbackItemsByComandaId.set(item.comanda_id, list);
    }
  }

  const queue = rawQueue.map((row) => {
    const id = typeof row.id === "string" ? row.id : "";
    return mapKdsQueueComanda(row, fallbackItemsByComandaId.get(id));
  });

  const products = ((productsRes.data ?? []) as Record<string, unknown>[]).map(
    mapProduct
  );
  const categories = ((categoriesRes.data ?? []) as Record<string, unknown>[]).map(
    mapCategory
  );

  return {
    profile,
    queue,
    settings,
    products,
    categories,
  };
}
