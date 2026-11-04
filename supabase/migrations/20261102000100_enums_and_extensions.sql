-- ============================================================================
-- Pedidos Flash — Migración 01: Extensiones y Tipos Enumerados Canónicos
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.user_role AS ENUM ('admin', 'mozo', 'cocina', 'caja');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'table_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.table_status AS ENUM ('libre', 'ocupada', 'pendiente_cobro');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.session_status AS ENUM ('abierta', 'pendiente_cobro', 'cerrada');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'comanda_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.comanda_status AS ENUM ('nuevo', 'recibido', 'preparando', 'listo', 'entregado');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'comanda_type' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.comanda_type AS ENUM ('original', 'adicion', 'correccion');
  END IF;
END;
$$;
