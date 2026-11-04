import "server-only";
import { redirect } from "next/navigation";
import {
  ROLE_HOME_ROUTES,
  USER_ROLES,
  type UserProfile,
  type UserRole,
} from "@/contracts/domain";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AuthErrorCode = "UNAUTHENTICATED" | "INACTIVE_USER" | "FORBIDDEN";

export class AuthError extends Error {
  public readonly code: AuthErrorCode;
  public readonly statusCode: 401 | 403;

  constructor(message: string, code: AuthErrorCode, statusCode: 401 | 403) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function isValidRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export function mapUserProfileRow(row: Record<string, unknown>): UserProfile | null {
  const id = typeof row.id === "string" ? row.id : "";
  const email = typeof row.email === "string" ? row.email : "";
  const fullName = typeof row.full_name === "string" ? row.full_name : "";
  const role = row.role;
  const isActive = Boolean(row.is_active);
  const createdAt =
    typeof row.created_at === "string" ? row.created_at : new Date().toISOString();
  const updatedAt =
    typeof row.updated_at === "string" ? row.updated_at : createdAt;

  if (!id || !isValidRole(role)) {
    return null;
  }

  return {
    id,
    email,
    full_name: fullName,
    role,
    is_active: isActive,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

/**
 * Obtiene el perfil del usuario autenticado verificando sesión real en Supabase Auth
 * y estado activo en la tabla `profiles`. Devuelve `null` si no hay sesión válida o está inactivo.
 */
export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profileRow) {
    return null;
  }

  const profile = mapUserProfileRow(profileRow as Record<string, unknown>);
  if (!profile || !profile.is_active) {
    return null;
  }

  return profile;
}

/**
 * Verifica sesión activa en Supabase Auth + registro en `profiles` con `is_active === true`
 * y rol incluido en `allowedRoles`. Devuelve el perfil y el cliente autenticado.
 */
export async function requireRoleWithClient(allowedRoles: readonly UserRole[]) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new AuthError(
      "Debés iniciar sesión para realizar esta operación.",
      "UNAUTHENTICATED",
      401
    );
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profileRow) {
    throw new AuthError(
      "No se encontró un perfil válido asociado a tu cuenta.",
      "UNAUTHENTICATED",
      401
    );
  }

  const profile = mapUserProfileRow(profileRow as Record<string, unknown>);
  if (!profile) {
    throw new AuthError(
      "El perfil de usuario contiene un rol inválido.",
      "FORBIDDEN",
      403
    );
  }

  if (!profile.is_active) {
    throw new AuthError(
      "Tu cuenta se encuentra desactivada. Contactá al administrador.",
      "INACTIVE_USER",
      403
    );
  }

  if (!allowedRoles.includes(profile.role)) {
    throw new AuthError(
      "No tenés permisos suficientes para realizar esta acción.",
      "FORBIDDEN",
      403
    );
  }

  return { profile, supabase };
}

/**
 * Verifica que exista sesión válida, usuario activo y rol permitido.
 * Lanza `AuthError` (401/403) en caso contrario.
 */
export async function requireRole(
  allowedRoles: readonly UserRole[]
): Promise<UserProfile> {
  const { profile } = await requireRoleWithClient(allowedRoles);
  return profile;
}

/**
 * Helper para Server Components que redirige automáticamente a `/login`
 * o al home del rol correspondiente si el usuario no tiene acceso a la vista.
 */
export async function requirePageRole(
  allowedRoles: readonly UserRole[]
): Promise<UserProfile> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  const profile = profileRow
    ? mapUserProfileRow(profileRow as Record<string, unknown>)
    : null;

  if (!profile || !profile.is_active) {
    redirect("/login?error=cuenta_inactiva");
  }

  if (!allowedRoles.includes(profile.role)) {
    redirect(ROLE_HOME_ROUTES[profile.role]);
  }

  return profile;
}
