"use server";

import { revalidatePath } from "next/cache";
import {
  COMANDA_STATUSES,
  canTransitionComandaStatus,
  type ActionResult,
  type ComandaStatus,
} from "@/contracts/domain";
import {
  RPC_NAMES,
  type AdvanceComandaStatusRpcArgs,
  type AdvanceComandaStatusRpcResult,
  type CreateComandaRpcArgs,
  type CreateComandaRpcResult,
} from "@/contracts/rpc";
import {
  advanceComandaStatusSchema,
  createComandaSchema,
} from "@/contracts/schemas";
import { requireRoleWithClient } from "@/server/auth/session";
import {
  notifyKitchenNewComanda,
  notifyWaiterComandaReady,
} from "@/server/notifications/web-push";
import {
  extractPostgrestError,
  handleActionError,
  unwrapRpcResult,
  validationFailure,
} from "./_helpers";

function isValidComandaStatus(value: unknown): value is ComandaStatus {
  return (
    typeof value === "string" &&
    (COMANDA_STATUSES as readonly string[]).includes(value)
  );
}

export async function createComandaAction(
  input: unknown
): Promise<ActionResult<CreateComandaRpcResult>> {
  try {
    const parsed = createComandaSchema.safeParse(input);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { supabase } = await requireRoleWithClient(["mozo", "admin"]);

    // Verificar en servidor que todos los productos existan, estén activos y disponibles
    const uniqueProductIds = Array.from(
      new Set(parsed.data.items.map((item) => item.productId))
    );

    const { data: productRows, error: productsError } = await supabase
      .from("products")
      .select("id, name, is_active, is_available")
      .in("id", uniqueProductIds);

    if (productsError) {
      const mapped = extractPostgrestError(
        productsError,
        "No se pudo verificar la disponibilidad de productos."
      );
      return { ok: false, ...mapped };
    }

    const productById = new Map<
      string,
      { id: string; name: string; is_active: boolean; is_available: boolean }
    >();

    for (const row of (productRows ?? []) as Record<string, unknown>[]) {
      const id = typeof row.id === "string" ? row.id : "";
      if (id) {
        productById.set(id, {
          id,
          name: typeof row.name === "string" ? row.name : "Producto",
          is_active: row.is_active !== false,
          is_available: row.is_available !== false,
        });
      }
    }

    // Antes de bloquear por agotado/inactivo, verificar si esta clave idempotente ya existe
    // para garantizar replay idempotente limpio incluso si un producto se agotó justo después
    const { data: existingComanda } = await supabase
      .from("comandas")
      .select("id")
      .eq("idempotency_key", parsed.data.idempotencyKey)
      .maybeSingle();

    if (!existingComanda) {
      for (const item of parsed.data.items) {
        const product = productById.get(item.productId);
        if (!product) {
          return {
            ok: false,
            error: "Uno de los productos seleccionados no existe en el menú.",
            code: "PRODUCT_NOT_FOUND",
          };
        }
        if (!product.is_active) {
          return {
            ok: false,
            error: `El producto "${product.name}" está inactivo y no puede agregarse a la comanda.`,
            code: "PRODUCT_INACTIVE",
          };
        }
        if (!product.is_available) {
          return {
            ok: false,
            error: `El producto "${product.name}" figura como agotado actualmente.`,
            code: "PRODUCT_UNAVAILABLE",
          };
        }
      }
    }

    const rpcArgs: CreateComandaRpcArgs = {
      p_table_session_id: parsed.data.tableSessionId,
      p_idempotency_key: parsed.data.idempotencyKey,
      p_items: parsed.data.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
        special_instructions: item.specialInstructions?.trim() || null,
      })),
      p_notes: parsed.data.notes?.trim() || null,
      p_comanda_type: parsed.data.comandaType,
      p_parent_comanda_id: parsed.data.parentComandaId ?? null,
    };

    const { data, error } = await supabase.rpc(
      RPC_NAMES.CREATE_COMANDA_IDEMPOTENT,
      rpcArgs
    );

    if (error) {
      const mapped = extractPostgrestError(
        error,
        "No se pudo enviar la comanda a cocina."
      );
      return { ok: false, ...mapped };
    }

    const result = unwrapRpcResult<CreateComandaRpcResult>(data);

    if (!result.idempotent_replay) {
      const totalItemsQty = parsed.data.items.reduce(
        (acc, item) => acc + item.quantity,
        0
      );

      // Disparo no bloqueante de Web Push a cocina
      void (async () => {
        try {
          const { data: sessionRow } = await supabase
            .from("table_sessions")
            .select("table_id")
            .eq("id", parsed.data.tableSessionId)
            .maybeSingle();

          let tableCode = "Salón";
          const tableId =
            sessionRow && typeof sessionRow.table_id === "string"
              ? sessionRow.table_id
              : "";
          if (tableId) {
            const { data: tableRow } = await supabase
              .from("dining_tables")
              .select("code")
              .eq("id", tableId)
              .maybeSingle();
            if (tableRow && typeof tableRow.code === "string") {
              tableCode = tableRow.code;
            }
          }

          await notifyKitchenNewComanda({
            comandaNumber: result.comanda_number,
            tableCode,
            itemsCount: totalItemsQty,
            comandaType: parsed.data.comandaType,
          });
        } catch {
          // Degradación silenciosa
        }
      })();
    }

    revalidatePath("/mozo");
    revalidatePath("/cocina");
    revalidatePath("/caja");

    return {
      ok: true,
      data: result,
    };
  } catch (err) {
    return handleActionError(err, "Error al registrar la comanda.");
  }
}

export async function advanceComandaStatusAction(
  input: unknown
): Promise<ActionResult<AdvanceComandaStatusRpcResult>> {
  try {
    const parsed = advanceComandaStatusSchema.safeParse(input);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const allowedRoles =
      parsed.data.targetStatus === "entregado"
        ? (["mozo", "cocina", "admin"] as const)
        : (["cocina", "admin"] as const);

    const { profile, supabase } = await requireRoleWithClient(allowedRoles);

    const { data: currentComanda, error: fetchError } = await supabase
      .from("comandas")
      .select("id, status")
      .eq("id", parsed.data.comandaId)
      .maybeSingle();

    if (fetchError || !currentComanda) {
      return {
        ok: false,
        error: "No se encontró la comanda solicitada.",
        code: "COMANDA_NOT_FOUND",
      };
    }

    const currentStatus = isValidComandaStatus(currentComanda.status)
      ? currentComanda.status
      : null;

    if (
      currentStatus &&
      currentStatus !== parsed.data.targetStatus &&
      !canTransitionComandaStatus(
        currentStatus,
        parsed.data.targetStatus,
        profile.role
      )
    ) {
      return {
        ok: false,
        error: `No se puede pasar la comanda de "${currentStatus}" a "${parsed.data.targetStatus}".`,
        code: "INVALID_STATUS_TRANSITION",
      };
    }

    const rpcArgs: AdvanceComandaStatusRpcArgs = {
      p_comanda_id: parsed.data.comandaId,
      p_target_status: parsed.data.targetStatus,
    };

    const { data, error } = await supabase.rpc(
      RPC_NAMES.ADVANCE_COMANDA_STATUS,
      rpcArgs
    );

    if (error) {
      const mapped = extractPostgrestError(
        error,
        "No se pudo actualizar el estado de la comanda."
      );
      return { ok: false, ...mapped };
    }

    const result = unwrapRpcResult<AdvanceComandaStatusRpcResult>(data);

    // Notificar de manera no bloqueante al mozo creador cuando la comanda pasa a `listo`
    if (
      !result.already_in_status &&
      result.new_status === "listo" &&
      result.created_by
    ) {
      void notifyWaiterComandaReady({
        waiterId: result.created_by,
        comandaNumber: result.comanda_number,
        tableCode: result.table_code,
      });
    }

    revalidatePath("/cocina");
    revalidatePath("/mozo");
    revalidatePath("/caja");

    return {
      ok: true,
      data: result,
    };
  } catch (err) {
    return handleActionError(
      err,
      "Error al avanzar el estado de la comanda."
    );
  }
}
