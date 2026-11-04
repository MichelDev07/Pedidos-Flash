"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/contracts/domain";
import {
  RPC_NAMES,
  type RegisterPaymentRpcArgs,
  type RegisterPaymentRpcResult,
} from "@/contracts/rpc";
import { registerPaymentSchema } from "@/contracts/schemas";
import { requireRoleWithClient } from "@/server/auth/session";
import {
  extractPostgrestError,
  handleActionError,
  unwrapRpcResult,
  validationFailure,
} from "./_helpers";

export async function registerPaymentAction(
  input: unknown
): Promise<ActionResult<RegisterPaymentRpcResult>> {
  try {
    const parsed = registerPaymentSchema.safeParse(input);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { supabase } = await requireRoleWithClient(["caja", "admin"]);

    const { data: methodRow, error: methodError } = await supabase
      .from("payment_methods")
      .select("id, is_active, is_cash, requires_reference")
      .eq("id", parsed.data.paymentMethodId)
      .maybeSingle();

    if (methodError || !methodRow) {
      return {
        ok: false,
        error: "El método de pago seleccionado no existe.",
        code: "PAYMENT_METHOD_NOT_FOUND",
      };
    }

    if (methodRow.is_active === false) {
      return {
        ok: false,
        error: "El método de pago seleccionado no se encuentra habilitado.",
        code: "PAYMENT_METHOD_INACTIVE",
      };
    }

    const cleanReference = parsed.data.referenceCode?.trim() || null;

    if (methodRow.requires_reference && !cleanReference) {
      return {
        ok: false,
        error: "Este método de pago requiere ingresar número de comprobante o referencia.",
        code: "REFERENCE_REQUIRED",
      };
    }

    if (
      methodRow.is_cash &&
      parsed.data.amountTendered !== null &&
      parsed.data.amountTendered !== undefined &&
      parsed.data.amountTendered < parsed.data.amount
    ) {
      return {
        ok: false,
        error: "El monto recibido en efectivo no puede ser menor al monto a cobrar.",
        code: "INSUFFICIENT_TENDERED",
      };
    }

    const rpcArgs: RegisterPaymentRpcArgs = {
      p_table_session_id: parsed.data.tableSessionId,
      p_payment_method_id: parsed.data.paymentMethodId,
      p_amount: parsed.data.amount,
      p_idempotency_key: parsed.data.idempotencyKey,
      p_amount_tendered: parsed.data.amountTendered ?? null,
      p_reference_code: cleanReference,
    };

    const { data, error } = await supabase.rpc(
      RPC_NAMES.REGISTER_PAYMENT_AND_CLOSE_TABLE,
      rpcArgs
    );

    if (error) {
      const mapped = extractPostgrestError(
        error,
        "No se pudo registrar el cobro de la mesa."
      );
      return { ok: false, ...mapped };
    }

    const result = unwrapRpcResult<RegisterPaymentRpcResult>(data);

    revalidatePath("/caja");
    revalidatePath("/mozo");
    revalidatePath("/admin");

    return {
      ok: true,
      data: result,
    };
  } catch (err) {
    return handleActionError(err, "Error al registrar el cobro en caja.");
  }
}
