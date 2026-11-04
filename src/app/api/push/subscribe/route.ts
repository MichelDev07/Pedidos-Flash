import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { USER_ROLES } from "@/contracts/domain";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { AuthError, requireRole } from "@/server/auth/session";

const rawSubscriptionObjectSchema = z.object({
  endpoint: z.string().trim().url("Endpoint de suscripción inválido"),
  keys: z
    .object({
      p256dh: z.string().trim().min(1, "Clave p256dh requerida"),
      auth: z.string().trim().min(1, "Clave auth requerida"),
    })
    .optional(),
  p256dh: z.string().trim().min(1).optional(),
  auth: z.string().trim().min(1).optional(),
  userAgent: z.string().trim().max(500).optional(),
});

const subscribeBodySchema = z.union([
  rawSubscriptionObjectSchema,
  z.object({
    subscription: rawSubscriptionObjectSchema,
    userAgent: z.string().trim().max(500).optional(),
  }),
]);

const unsubscribeSchema = z.object({
  endpoint: z.string().trim().url("Endpoint requerido para cancelar suscripción"),
});

function extractNormalizedSubscription(body: z.infer<typeof subscribeBodySchema>): {
  endpoint: string;
  p256dh: string;
  auth: string;
} | null {
  const target = "subscription" in body ? body.subscription : body;
  const p256dh = target.keys?.p256dh ?? target.p256dh ?? "";
  const auth = target.keys?.auth ?? target.auth ?? "";

  if (!target.endpoint || !p256dh || !auth) {
    return null;
  }

  return {
    endpoint: target.endpoint,
    p256dh,
    auth,
  };
}

export async function POST(request: NextRequest) {
  try {
    const profile = await requireRole(USER_ROLES);

    let jsonBody: unknown;
    try {
      jsonBody = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Cuerpo JSON inválido.", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const parsed = subscribeBodySchema.safeParse(jsonBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error:
            parsed.error.issues[0]?.message ??
            "Datos de suscripción Web Push inválidos.",
          code: "VALIDATION_ERROR",
        },
        { status: 400 }
      );
    }

    const subscription = extractNormalizedSubscription(parsed.data);
    if (!subscription) {
      return NextResponse.json(
        {
          ok: false,
          error: "Faltan las claves criptográficas p256dh o auth de la suscripción.",
          code: "VALIDATION_ERROR",
        },
        { status: 400 }
      );
    }

    // Reasignar o insertar suscripción para el dispositivo actual (soporta tablets compartidas por turno)
    const supabaseAdmin = createAdminSupabaseClient();
    const { data: existing } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id")
      .eq("endpoint", subscription.endpoint)
      .maybeSingle();

    if (existing && typeof existing.id === "string") {
      const { error: updateError } = await supabaseAdmin
        .from("push_subscriptions")
        .update({
          user_id: profile.id,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        })
        .eq("id", existing.id);

      if (updateError) {
        return NextResponse.json(
          {
            ok: false,
            error: "No se pudo actualizar la suscripción de notificaciones.",
            code: "DB_ERROR",
          },
          { status: 500 }
        );
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from("push_subscriptions")
        .insert({
          user_id: profile.id,
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        });

      if (insertError) {
        return NextResponse.json(
          {
            ok: false,
            error: "No se pudo guardar la suscripción de notificaciones.",
            code: "DB_ERROR",
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Error interno al procesar la suscripción Web Push.",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const profile = await requireRole(USER_ROLES);

    let endpointCandidate = request.nextUrl.searchParams.get("endpoint") ?? "";

    if (!endpointCandidate) {
      try {
        const body = (await request.json()) as Record<string, unknown>;
        if (typeof body?.endpoint === "string") {
          endpointCandidate = body.endpoint;
        }
      } catch {
        // Sin cuerpo JSON; validaremos endpointCandidate abajo
      }
    }

    const parsed = unsubscribeSchema.safeParse({ endpoint: endpointCandidate });
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error:
            parsed.error.issues[0]?.message ??
            "Endpoint inválido para eliminar suscripción.",
          code: "VALIDATION_ERROR",
        },
        { status: 400 }
      );
    }

    const supabaseAdmin = createAdminSupabaseClient();
    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", profile.id)
      .eq("endpoint", parsed.data.endpoint);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "No se pudo eliminar la suscripción Web Push.",
          code: "DB_ERROR",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Error interno al eliminar la suscripción Web Push.",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}
