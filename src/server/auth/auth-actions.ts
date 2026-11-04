"use server";

import { revalidatePath } from "next/cache";
import {
  ROLE_HOME_ROUTES,
  type ActionResult,
  type UserProfile,
} from "@/contracts/domain";
import { loginSchema } from "@/contracts/schemas";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mapUserProfileRow } from "@/server/auth/session";

export interface SignInResult {
  redirectTo: string;
  profile: UserProfile;
}

export async function signInAction(
  input: unknown
): Promise<ActionResult<SignInResult>> {
  const normalizedInput =
    input instanceof FormData
      ? {
          email: String(input.get("email") ?? ""),
          password: String(input.get("password") ?? ""),
        }
      : input;

  const parsed = loginSchema.safeParse(normalizedInput);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      ok: false,
      error: firstIssue?.message ?? "Datos de acceso inválidos.",
      code: "VALIDATION_ERROR",
    };
  }

  const supabase = await createServerSupabaseClient();
  const { data: authData, error: signInError } =
    await supabase.auth.signInWithPassword({
      email: parsed.data.email.toLowerCase(),
      password: parsed.data.password,
    });

  if (signInError || !authData.user) {
    return {
      ok: false,
      error: "Credenciales inválidas. Verificá tu correo y contraseña.",
      code: "INVALID_CREDENTIALS",
    };
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, created_at, updated_at")
    .eq("id", authData.user.id)
    .maybeSingle();

  const profile =
    !profileError && profileRow
      ? mapUserProfileRow(profileRow as Record<string, unknown>)
      : null;

  if (!profile) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error: "Tu cuenta no tiene un perfil operativo asignado.",
      code: "PROFILE_NOT_FOUND",
    };
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error: "Tu cuenta está desactivada. Contactá al administrador.",
      code: "INACTIVE_USER",
    };
  }

  revalidatePath("/", "layout");

  return {
    ok: true,
    data: {
      redirectTo: ROLE_HOME_ROUTES[profile.role],
      profile,
    },
  };
}

export async function signOutAction(): Promise<
  ActionResult<{ redirectTo: string }>
> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    return {
      ok: false,
      error: "No se pudo cerrar la sesión. Intentá nuevamente.",
      code: "SIGN_OUT_ERROR",
    };
  }

  revalidatePath("/", "layout");

  return {
    ok: true,
    data: {
      redirectTo: "/login",
    },
  };
}
