"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/contracts/domain";
import {
  RPC_NAMES,
  type OpenTableSessionRpcArgs,
  type OpenTableSessionRpcResult,
  type RequestTableBillRpcArgs,
  type RequestTableBillRpcResult,
} from "@/contracts/rpc";
import {
  openTableSessionSchema,
  requestTableBillSchema,
} from "@/contracts/schemas";
import { requireRoleWithClient } from "@/server/auth/session";
import {
  extractPostgrestError,
  handleActionError,
  unwrapRpcResult,
  validationFailure,
} from "./_helpers";

const cancelEmptyTableSessionSchema = z.object({
  tableSessionId: z.string().uuid("Sesión de mesa inválida"),
});

export interface CancelEmptyTableSessionResult {
  session_id: string;
  table_id?: string;
  cancelled: boolean;
}

export async function openTableSessionAction(
  input: unknown
): Promise<ActionResult<OpenTableSessionRpcResult>> {
  try {
    const parsed = openTableSessionSchema.safeParse(input);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { supabase } = await requireRoleWithClient(["mozo", "admin"]);

    const rpcArgs: OpenTableSessionRpcArgs = {
      p_table_id: parsed.data.tableId,
      p_idempotency_key: parsed.data.idempotencyKey,
    };

    const { data, error } = await supabase.rpc(
      RPC_NAMES.OPEN_TABLE_SESSION,
      rpcArgs
    );

    if (error) {
      const mapped = extractPostgrestError(
        error,
        "No se pudo abrir la mesa seleccionada."
      );
      return { ok: false, ...mapped };
    }

    const result = unwrapRpcResult<OpenTableSessionRpcResult>(data);

    revalidatePath("/mozo");
    revalidatePath("/caja");
    revalidatePath("/admin");

    return {
      ok: true,
      data: result,
    };
  } catch (err) {
    return handleActionError(err, "No se pudo abrir la sesión de mesa.");
  }
}

export async function requestTableBillAction(
  input: unknown
): Promise<ActionResult<RequestTableBillRpcResult>> {
  try {
    const parsed = requestTableBillSchema.safeParse(input);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { supabase } = await requireRoleWithClient(["mozo", "caja", "admin"]);

    const rpcArgs: RequestTableBillRpcArgs = {
      p_table_session_id: parsed.data.tableSessionId,
      p_force: parsed.data.forceWithPendingKitchen,
    };

    const { data, error } = await supabase.rpc(
      RPC_NAMES.REQUEST_TABLE_BILL,
      rpcArgs
    );

    if (error) {
      const mapped = extractPostgrestError(
        error,
        "No se pudo solicitar la cuenta de la mesa."
      );
      return { ok: false, ...mapped };
    }

    const result = unwrapRpcResult<RequestTableBillRpcResult>(data);

    revalidatePath("/mozo");
    revalidatePath("/caja");
    revalidatePath("/admin");

    return {
      ok: true,
      data: result,
    };
  } catch (err) {
    return handleActionError(err, "Error al solicitar la cuenta de la mesa.");
  }
}

export async function cancelEmptyTableSessionAction(
  input: unknown
): Promise<ActionResult<CancelEmptyTableSessionResult>> {
  try {
    const normalizedInput =
      typeof input === "string" ? { tableSessionId: input } : input;

    const parsed = cancelEmptyTableSessionSchema.safeParse(normalizedInput);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { supabase } = await requireRoleWithClient(["mozo", "caja", "admin"]);

    const { data, error } = await supabase.rpc(
      RPC_NAMES.CANCEL_EMPTY_TABLE_SESSION,
      {
        p_table_session_id: parsed.data.tableSessionId,
      }
    );

    if (error) {
      const mapped = extractPostgrestError(
        error,
        "No se pudo cancelar la sesión de mesa vacía."
      );
      return { ok: false, ...mapped };
    }

    let tableId: string | undefined;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const record = data as Record<string, unknown>;
      if (typeof record.table_id === "string") {
        tableId = record.table_id;
      }
    } else if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
      const record = data[0] as Record<string, unknown>;
      if (typeof record.table_id === "string") {
        tableId = record.table_id;
      }
    }

    revalidatePath("/mozo");
    revalidatePath("/caja");
    revalidatePath("/admin");

    return {
      ok: true,
      data: {
        session_id: parsed.data.tableSessionId,
        table_id: tableId,
        cancelled: true,
      },
    };
  } catch (err) {
    return handleActionError(
      err,
      "Error al cancelar la sesión de mesa sin consumo."
    );
  }
}
