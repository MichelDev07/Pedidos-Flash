import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env/server";

/**
 * Cliente administrativo exclusivo de servidor con SUPABASE_SERVICE_ROLE_KEY.
 * USO RESTRINGIDO ÚNICAMENTE A:
 * 1. Creación y gestión administrativa de cuentas en `auth.admin` tras verificar rol `admin`.
 * 2. Lectura/depuración de suscripciones Web Push en segundo plano.
 */
export function createAdminSupabaseClient() {
  const env = getServerEnv();

  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
