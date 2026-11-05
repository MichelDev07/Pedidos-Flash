import { NextResponse } from "next/server";
import { ROLE_HOME_ROUTES, USER_ROLES, type UserRole } from "@/contracts/domain";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // 1. Consultar el perfil existente del usuario
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", data.user.id)
        .maybeSingle();

      let activeRole: UserRole = "mozo";
      let isActive = true;

      if (profileRow) {
        isActive = profileRow.is_active === true;
        if ((USER_ROLES as readonly string[]).includes(profileRow.role)) {
          activeRole = profileRow.role as UserRole;
        }
      } else {
        // En caso de que el trigger aún no haya creado el perfil
        const fullName =
          data.user.user_metadata?.full_name ||
          data.user.user_metadata?.name ||
          data.user.email?.split("@")[0] ||
          "Personal";

        await supabase
          .from("profiles")
          .upsert(
            {
              id: data.user.id,
              email: data.user.email ?? `${data.user.id}@pedidosflash.local`,
              full_name: fullName,
              role: "mozo",
              is_active: true,
            },
            { onConflict: "id" }
          );
      }

      if (!isActive) {
        return NextResponse.redirect(new URL("/login?error=cuenta_inactiva", requestUrl.origin));
      }

      const destination =
        next && next.startsWith("/") && next !== "/"
          ? next
          : ROLE_HOME_ROUTES[activeRole] ?? ROLE_HOME_ROUTES.mozo;

      return NextResponse.redirect(new URL(destination, requestUrl.origin));
    }
  }

  // Si falló el intercambio de código
  return NextResponse.redirect(new URL("/login?error=oauth_error", requestUrl.origin));
}
