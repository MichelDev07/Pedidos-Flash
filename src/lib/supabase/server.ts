import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getClientEnv } from "@/lib/env/client";

/**
 * Crea un cliente Supabase para Server Components, Server Actions y Route Handlers.
 * Opera bajo la sesión del usuario autenticado respetando RLS en PostgreSQL.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const env = getClientEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Ignorado cuando se invoca desde un Server Component de solo lectura;
            // el Middleware refresca y persiste las cookies de sesión en cada request.
          }
        },
      },
    }
  );
}
