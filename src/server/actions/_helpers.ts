import "server-only";
import { ZodError } from "zod";
import type { ActionResult } from "@/contracts/domain";
import { AuthError } from "@/server/auth/session";

export function validationFailure<T = never>(
  zodError: ZodError
): ActionResult<T> {
  const firstIssue = zodError.issues[0];
  return {
    ok: false,
    error: firstIssue?.message ?? "Los datos enviados no son válidos.",
    code: "VALIDATION_ERROR",
  };
}

export function extractPostgrestError(
  error: { message?: string; code?: string; details?: string | null },
  fallbackMessage: string
): { error: string; code: string } {
  const pgCode = error.code ?? "DB_ERROR";
  const rawMessage = (error.message ?? "").trim();

  if (pgCode === "23505") {
    return {
      error: "Ya existe un registro con ese código, correo o identificador.",
      code: "DUPLICATE_RECORD",
    };
  }

  if (pgCode === "23503") {
    return {
      error: "La referencia seleccionada no existe o ya no está disponible.",
      code: "FOREIGN_KEY_VIOLATION",
    };
  }

  if (pgCode === "42501") {
    return {
      error: "No tenés permisos para ejecutar esta operación.",
      code: "FORBIDDEN",
    };
  }

  return {
    error: rawMessage || fallbackMessage,
    code: pgCode,
  };
}

export function handleActionError<T = never>(
  err: unknown,
  fallbackMessage = "Ocurrió un error inesperado al procesar la solicitud."
): ActionResult<T> {
  if (err instanceof AuthError) {
    return {
      ok: false,
      error: err.message,
      code: err.code,
    };
  }

  if (err instanceof ZodError) {
    return validationFailure(err);
  }

  if (err && typeof err === "object" && "message" in err) {
    const message =
      typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : fallbackMessage;
    const code =
      "code" in err && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "ACTION_ERROR";

    return extractPostgrestError({ message, code }, fallbackMessage).code ===
      "DUPLICATE_RECORD"
      ? {
          ok: false,
          ...extractPostgrestError({ message, code }, fallbackMessage),
        }
      : {
          ok: false,
          error: message || fallbackMessage,
          code,
        };
  }

  return {
    ok: false,
    error: fallbackMessage,
    code: "INTERNAL_ERROR",
  };
}

/**
 * Normaliza la salida de un RPC de Supabase sin importar si la función SQL
 * fue declarada como `RETURNS jsonb` (objeto) o `RETURNS TABLE (...)` (array de 1 fila).
 */
export function unwrapRpcResult<T>(data: unknown): T {
  if (Array.isArray(data)) {
    const first = data[0];
    if (!first || typeof first !== "object") {
      throw new Error("La operación transaccional no devolvió datos.");
    }
    return first as T;
  }

  if (data && typeof data === "object") {
    return data as T;
  }

  throw new Error("Respuesta inválida de la operación transaccional.");
}
