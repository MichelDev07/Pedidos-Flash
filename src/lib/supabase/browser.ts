"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientEnv } from "@/lib/env/client";

let browserSupabaseClient: SupabaseClient | null = null;

/**
 * Crea o reutiliza el cliente singleton de Supabase para componentes cliente (Browser).
 * Respeta las cookies de sesión gestionadas por `@supabase/ssr` y las políticas RLS de PostgreSQL.
 */
export function createBrowserSupabaseClient(): SupabaseClient {
  const env = getClientEnv();

  if (typeof window === "undefined") {
    return createBrowserClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }

  if (!browserSupabaseClient) {
    browserSupabaseClient = createBrowserClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }

  return browserSupabaseClient;
}

/**
 * Limpia la instancia en caché del cliente Browser (útil en tests o reinicios de sesión).
 */
export function resetBrowserSupabaseClient(): void {
  browserSupabaseClient = null;
}
