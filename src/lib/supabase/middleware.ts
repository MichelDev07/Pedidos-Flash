import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  ROLE_HOME_ROUTES,
  USER_ROLES,
  canRoleAccessPath,
  type UserRole,
} from "@/contracts/domain";
import { getClientEnv } from "@/lib/env/client";

const PROTECTED_PREFIXES = ["/mozo", "/cocina", "/caja", "/admin"] as const;

export function isExcludedFromAuthMiddleware(pathname: string): boolean {
  if (
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/offline.html" ||
    pathname === "/favicon.ico" ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/health/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/icons" ||
    pathname.startsWith("/_next/")
  ) {
    return true;
  }

  return /\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|css|js|map)$/i.test(pathname);
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function isValidUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

function redirectWithCookies(url: URL, supabaseResponse: NextResponse): NextResponse {
  const redirectResponse = NextResponse.redirect(url);
  for (const cookie of supabaseResponse.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }
  return redirectResponse;
}

/**
 * Refresca la sesión SSR de Supabase, protege rutas operativas y aplica RBAC por rol.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (isExcludedFromAuthMiddleware(pathname)) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const env = getClientEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({
            request,
          });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const protectedRoute = isProtectedPath(pathname);
  const isLoginRoute = pathname === "/login" || pathname.startsWith("/login/");

  if (!user) {
    if (protectedRoute) {
      const loginUrl = new URL("/login", request.url);
      return redirectWithCookies(loginUrl, supabaseResponse);
    }
    return supabaseResponse;
  }

  if (protectedRoute || isLoginRoute) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .maybeSingle();

    const activeRole =
      profile && profile.is_active === true && isValidUserRole(profile.role)
        ? profile.role
        : null;

    if (!activeRole) {
      if (protectedRoute) {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("error", "cuenta_inactiva");
        return redirectWithCookies(loginUrl, supabaseResponse);
      }
      return supabaseResponse;
    }

    if (isLoginRoute) {
      const homeUrl = new URL(ROLE_HOME_ROUTES[activeRole], request.url);
      return redirectWithCookies(homeUrl, supabaseResponse);
    }

    if (!canRoleAccessPath(activeRole, pathname)) {
      const homeUrl = new URL(ROLE_HOME_ROUTES[activeRole], request.url);
      return redirectWithCookies(homeUrl, supabaseResponse);
    }
  }

  return supabaseResponse;
}
