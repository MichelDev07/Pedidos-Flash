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

-- ============================================================================
-- Pedidos Flash — Migración 02: Tablas Canónicas, Claves y Constraints
-- Todos los importes monetarios se almacenan como BIGINT exacto (ej. PYG enteros).
-- ============================================================================

-- 1. Configuración global del restaurante (Singleton id = 1)
CREATE TABLE public.restaurant_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name text NOT NULL DEFAULT 'Pedidos Flash'
    CHECK (char_length(btrim(business_name)) BETWEEN 2 AND 120),
  slogan text NOT NULL DEFAULT 'De la mesa a la cocina, en un flash.'
    CHECK (char_length(btrim(slogan)) BETWEEN 2 AND 160),
  currency_code text NOT NULL DEFAULT 'PYG'
    CHECK (currency_code IN ('PYG', 'USD', 'BRL', 'ARS')),
  currency_decimals integer NOT NULL DEFAULT 0
    CHECK (currency_decimals IN (0, 2)),
  tax_percentage numeric(5,2) NOT NULL DEFAULT 10.00
    CHECK (tax_percentage BETWEEN 0 AND 50),
  kds_warn_minutes integer NOT NULL DEFAULT 10
    CHECK (kds_warn_minutes BETWEEN 1 AND 120),
  kds_critical_minutes integer NOT NULL DEFAULT 20
    CHECK (kds_critical_minutes BETWEEN 2 AND 180 AND kds_critical_minutes >= kds_warn_minutes),
  sound_alerts_default boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Perfiles de personal vinculados 1:1 con auth.users
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  email text NOT NULL CHECK (char_length(btrim(email)) >= 3),
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
  role public.user_role NOT NULL DEFAULT 'mozo',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Sectores del salón
CREATE TABLE public.sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_sectors_name_ci ON public.sectors (lower(btrim(name)));

-- 4. Mesas operativas
CREATE TABLE public.dining_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (char_length(btrim(code)) BETWEEN 1 AND 20),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  sector_id uuid NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
  capacity integer NOT NULL DEFAULT 4 CHECK (capacity BETWEEN 1 AND 50),
  status public.table_status NOT NULL DEFAULT 'libre',
  current_session_id uuid NULL,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_dining_tables_session_coherence CHECK (
    (status = 'libre' AND current_session_id IS NULL)
    OR
    (status IN ('ocupada', 'pendiente_cobro') AND current_session_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_dining_tables_code_ci ON public.dining_tables (lower(btrim(code)));

-- 5. Sesiones de mesa
CREATE TABLE public.table_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  table_id uuid NOT NULL REFERENCES public.dining_tables(id) ON DELETE RESTRICT,
  opened_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  closed_by uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status public.session_status NOT NULL DEFAULT 'abierta',
  currency_code text NOT NULL DEFAULT 'PYG'
    CHECK (currency_code IN ('PYG', 'USD', 'BRL', 'ARS')),
  subtotal_amount bigint NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  total_amount bigint NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  paid_amount bigint NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  balance_due bigint GENERATED ALWAYS AS (GREATEST(total_amount - paid_amount, 0)) STORED,
  open_idempotency_key uuid NULL CONSTRAINT uq_table_sessions_open_idempotency_key UNIQUE,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL,
  CONSTRAINT chk_table_sessions_closed_coherence CHECK (
    (status = 'cerrada' AND closed_at IS NOT NULL)
    OR
    (status IN ('abierta', 'pendiente_cobro') AND closed_at IS NULL)
  )
);

-- FK diferible para cerrar la referencia circular controlada entre mesa y su sesión activa
ALTER TABLE public.dining_tables
  ADD CONSTRAINT fk_dining_tables_current_session
  FOREIGN KEY (current_session_id)
  REFERENCES public.table_sessions(id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY IMMEDIATE;

-- Garantía a nivel motor: máximo una sesión abierta o pendiente de cobro por mesa
CREATE UNIQUE INDEX uq_table_sessions_one_active_per_table
  ON public.table_sessions (table_id)
  WHERE status IN ('abierta', 'pendiente_cobro');

-- 6. Categorías del menú
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  slug text NOT NULL DEFAULT '' CONSTRAINT uq_categories_slug UNIQUE
    CHECK (char_length(btrim(slug)) >= 1),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_categories_name_ci ON public.categories (lower(btrim(name)));

-- 7. Productos del menú
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  description text NULL CHECK (description IS NULL OR char_length(description) <= 400),
  price_amount bigint NOT NULL CHECK (price_amount >= 0),
  image_url text NULL,
  is_available boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 8. Comandas enviadas a cocina
CREATE TABLE public.comandas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comanda_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  table_session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE RESTRICT,
  table_id uuid NOT NULL REFERENCES public.dining_tables(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status public.comanda_status NOT NULL DEFAULT 'nuevo',
  comanda_type public.comanda_type NOT NULL DEFAULT 'original',
  parent_comanda_id uuid NULL REFERENCES public.comandas(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL CONSTRAINT uq_comandas_idempotency_key UNIQUE,
  notes text NULL CHECK (notes IS NULL OR char_length(notes) <= 300),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NULL,
  preparing_at timestamptz NULL,
  ready_at timestamptz NULL,
  delivered_at timestamptz NULL,
  CONSTRAINT chk_comandas_self_parent CHECK (parent_comanda_id IS NULL OR parent_comanda_id <> id)
);

-- 9. Ítems de comanda con snapshot histórico inmutable
CREATE TABLE public.comanda_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comanda_id uuid NOT NULL REFERENCES public.comandas(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL CHECK (char_length(btrim(product_name_snapshot)) >= 1),
  unit_price_snapshot bigint NOT NULL CHECK (unit_price_snapshot >= 0),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  special_instructions text NULL CHECK (special_instructions IS NULL OR char_length(special_instructions) <= 240),
  subtotal bigint GENERATED ALWAYS AS ((quantity::bigint) * unit_price_snapshot) STORED
);

-- 10. Métodos de pago habilitables
CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CONSTRAINT uq_payment_methods_code UNIQUE
    CHECK (code ~ '^[a-z0-9_]{2,40}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  requires_reference boolean NOT NULL DEFAULT false,
  is_cash boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0)
);

-- 11. Pagos registrados en Caja
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE RESTRICT,
  payment_method_id uuid NOT NULL REFERENCES public.payment_methods(id) ON DELETE RESTRICT,
  amount bigint NOT NULL CHECK (amount > 0),
  amount_tendered bigint NULL CHECK (amount_tendered IS NULL OR amount_tendered >= amount),
  change_amount bigint NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
  currency_code text NOT NULL DEFAULT 'PYG'
    CHECK (currency_code IN ('PYG', 'USD', 'BRL', 'ARS')),
  reference_code text NULL CHECK (reference_code IS NULL OR char_length(reference_code) <= 120),
  idempotency_key uuid NOT NULL CONSTRAINT uq_payments_idempotency_key UNIQUE,
  cashier_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 12. Historial de transiciones de estado (Append-only)
CREATE TABLE public.status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('dining_table', 'table_session', 'comanda', 'payment')),
  entity_id uuid NOT NULL,
  from_status text NULL,
  to_status text NOT NULL,
  changed_by uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- 13. Auditoría forense general (Append-only)
CREATE TABLE public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text NOT NULL,
  record_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'RPC')),
  actor_id uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  actor_role public.user_role NULL,
  old_data jsonb NULL,
  new_data jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 14. Suscripciones Web Push por usuario/dispositivo
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL CONSTRAINT uq_push_subscriptions_endpoint UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- Pedidos Flash — Migración 03: Índices Compuestos y Triggers de Integridad
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ÍNDICES PARA CONSULTAS CALIENTES (KDS, Mapa Salón, Sesiones, Reportes)
-- ----------------------------------------------------------------------------

-- Cola KDS activa por antigüedad estricta (FIFO)
CREATE INDEX idx_comandas_kds_fifo
  ON public.comandas (created_at ASC, status)
  INCLUDE (comanda_number, table_session_id, table_id, created_by, comanda_type, parent_comanda_id, notes, version)
  WHERE status IN ('nuevo', 'recibido', 'preparando', 'listo');

CREATE INDEX idx_comandas_kds_pending_status
  ON public.comandas (status, created_at ASC)
  WHERE status IN ('nuevo', 'recibido', 'preparando');

-- Mapa de mesas activas por sector y orden visual
CREATE INDEX idx_dining_tables_sector_active
  ON public.dining_tables (sector_id, sort_order ASC, code ASC)
  INCLUDE (name, capacity, status, current_session_id)
  WHERE is_active = true;

-- Sesiones abiertas / pendientes de cobro
CREATE INDEX idx_table_sessions_active_status
  ON public.table_sessions (status, opened_at ASC)
  INCLUDE (table_id, opened_by, total_amount, paid_amount, balance_due)
  WHERE status IN ('abierta', 'pendiente_cobro');

-- Detalle de sesión: comandas, ítems y pagos asociados
CREATE INDEX idx_comandas_session_created
  ON public.comandas (table_session_id, created_at ASC);

CREATE INDEX idx_comandas_parent_id
  ON public.comandas (parent_comanda_id)
  WHERE parent_comanda_id IS NOT NULL;

CREATE INDEX idx_comanda_items_comanda_id
  ON public.comanda_items (comanda_id);

CREATE INDEX idx_payments_session_created
  ON public.payments (table_session_id, created_at ASC);

-- Catálogo activo para toma de pedidos móvil
CREATE INDEX idx_categories_active_sort
  ON public.categories (sort_order ASC, name ASC)
  WHERE is_active = true;

CREATE INDEX idx_products_catalog_active
  ON public.products (category_id, name ASC)
  INCLUDE (price_amount, is_available, image_url)
  WHERE is_active = true;

-- Consultas de reportes por rango de fechas, mozo, cajero y producto
CREATE INDEX idx_table_sessions_closed_date_waiter
  ON public.table_sessions (closed_at DESC, opened_by)
  INCLUDE (total_amount, subtotal_amount, paid_amount)
  WHERE status = 'cerrada';

CREATE INDEX idx_comandas_created_by_date
  ON public.comandas (created_by, created_at DESC)
  INCLUDE (table_session_id, status, comanda_type);

CREATE INDEX idx_payments_created_cashier_method
  ON public.payments (created_at DESC, cashier_id, payment_method_id)
  INCLUDE (amount, currency_code, table_session_id);

CREATE INDEX idx_comanda_items_product_id
  ON public.comanda_items (product_id)
  INCLUDE (quantity, subtotal, unit_price_snapshot);

-- Trazabilidad, auditoría y notificaciones Push
CREATE INDEX idx_status_history_entity_date
  ON public.status_history (entity_type, entity_id, changed_at DESC);

CREATE INDEX idx_audit_logs_table_record_date
  ON public.audit_logs (table_name, record_id, created_at DESC);

CREATE INDEX idx_audit_logs_created_at_brin
  ON public.audit_logs USING BRIN (created_at);

CREATE INDEX idx_push_subscriptions_user_id
  ON public.push_subscriptions (user_id);

-- ----------------------------------------------------------------------------
-- 2. TRIGGERS UTILITARIOS, DE SINCRONIZACIÓN E INMUTABILIDAD
-- ----------------------------------------------------------------------------

-- 2.1 Actualización automática de updated_at
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at_restaurant_settings
  BEFORE UPDATE ON public.restaurant_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER set_updated_at_dining_tables
  BEFORE UPDATE ON public.dining_tables
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER set_updated_at_products
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER set_updated_at_push_subscriptions
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2.2 Coherencia automática de decimales según moneda en restaurant_settings
CREATE OR REPLACE FUNCTION public.tg_sync_restaurant_currency_decimals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  NEW.currency_decimals := CASE WHEN NEW.currency_code = 'PYG' THEN 0 ELSE 2 END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_restaurant_currency_decimals
  BEFORE INSERT OR UPDATE ON public.restaurant_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_restaurant_currency_decimals();

-- 2.3 Generación automática de slug en categories si se omite en INSERT/UPDATE
CREATE OR REPLACE FUNCTION public.tg_ensure_category_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_base_slug text;
  v_candidate text;
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    v_base_slug := regexp_replace(
      translate(
        lower(btrim(NEW.name)),
        'áàäâãéèëêíìïîóòöôõúùüûñç',
        'aaaaaeeeeiiiiooooouuuunc'
      ),
      '[^a-z0-9]+',
      '-',
      'g'
    );
    v_base_slug := btrim(v_base_slug, '-');
    IF v_base_slug = '' THEN
      v_base_slug := 'categoria';
    END IF;

    v_candidate := v_base_slug;
    IF EXISTS (
      SELECT 1 FROM public.categories c
      WHERE c.slug = v_candidate AND c.id IS DISTINCT FROM NEW.id
    ) THEN
      v_candidate := v_base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    END IF;

    NEW.slug := v_candidate;
  ELSE
    NEW.slug := lower(btrim(NEW.slug));
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ensure_category_slug
  BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.tg_ensure_category_slug();

-- 2.4 Sincronización inicial segura desde auth.users -> public.profiles
-- Lee el rol únicamente de raw_app_meta_data (inmutable por el cliente).
CREATE OR REPLACE FUNCTION public.tg_handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_role public.user_role := 'mozo';
  v_full_name text;
  v_is_active boolean := true;
BEGIN
  IF NEW.raw_app_meta_data ? 'role'
     AND (NEW.raw_app_meta_data->>'role') IN ('admin', 'mozo', 'cocina', 'caja') THEN
    v_role := (NEW.raw_app_meta_data->>'role')::public.user_role;
  END IF;

  IF NEW.raw_app_meta_data ? 'is_active' THEN
    v_is_active := COALESCE((NEW.raw_app_meta_data->>'is_active')::boolean, true);
  END IF;

  v_full_name := COALESCE(
    NULLIF(btrim(NEW.raw_app_meta_data->>'full_name'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'Personal'
  );

  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, NEW.id::text || '@pedidosflash.local'),
    v_full_name,
    v_role,
    v_is_active
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        updated_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_handle_new_auth_user();

CREATE OR REPLACE FUNCTION public.tg_sync_auth_user_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
    SET email = NEW.email,
        updated_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_auth_user_email();

-- 2.5 Protección contra desactivación o degradación del último admin activo
CREATE OR REPLACE FUNCTION public.tg_protect_last_active_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF OLD.role = 'admin' AND OLD.is_active = true
     AND (NEW.role <> 'admin' OR NEW.is_active = false) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.role = 'admin' AND p.is_active = true AND p.id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'LAST_ADMIN_PROTECTION: No se puede desactivar ni cambiar el rol del único administrador activo.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_last_active_admin
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_protect_last_active_admin();

-- 2.6 Guarda de estado operativo en dining_tables (solo mutable dentro de RPCs transaccionales)
CREATE OR REPLACE FUNCTION public.tg_guard_dining_table_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.current_session_id IS DISTINCT FROM OLD.current_session_id)
     AND COALESCE(current_setting('app.in_transactional_rpc', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'DIRECT_STATE_MUTATION_FORBIDDEN: El estado operativo de una mesa solo puede modificarse mediante las funciones RPC transaccionales.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_dining_table_state
  BEFORE UPDATE ON public.dining_tables
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_dining_table_state();

-- 2.7 Inmutabilidad estricta (Append-only) para comanda_items, status_history y audit_logs
CREATE OR REPLACE FUNCTION public.tg_prevent_mutation_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: Los registros de %.% son inmutables y no admiten %.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER immutable_comanda_items
  BEFORE UPDATE OR DELETE ON public.comanda_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_prevent_mutation_append_only();

CREATE TRIGGER immutable_status_history
  BEFORE UPDATE OR DELETE ON public.status_history
  FOR EACH ROW EXECUTE FUNCTION public.tg_prevent_mutation_append_only();

CREATE TRIGGER immutable_audit_logs
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_prevent_mutation_append_only();

-- 2.8 Auditoría forense automática sobre tablas maestras y financieras
CREATE OR REPLACE FUNCTION public.tg_audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role public.user_role;
  v_record_id text;
BEGIN
  IF v_actor_id IS NOT NULL THEN
    SELECT p.role INTO v_actor_role FROM public.profiles p WHERE p.id = v_actor_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_record_id := COALESCE(to_jsonb(OLD)->>'id', 'unknown');
    INSERT INTO public.audit_logs (table_name, record_id, action, actor_id, actor_role, old_data)
    VALUES (TG_TABLE_NAME, v_record_id, 'DELETE', v_actor_id, v_actor_role, to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      v_record_id := COALESCE(to_jsonb(NEW)->>'id', 'unknown');
      INSERT INTO public.audit_logs (table_name, record_id, action, actor_id, actor_role, old_data, new_data)
      VALUES (TG_TABLE_NAME, v_record_id, 'UPDATE', v_actor_id, v_actor_role, to_jsonb(OLD), to_jsonb(NEW));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    v_record_id := COALESCE(to_jsonb(NEW)->>'id', 'unknown');
    INSERT INTO public.audit_logs (table_name, record_id, action, actor_id, actor_role, new_data)
    VALUES (TG_TABLE_NAME, v_record_id, 'INSERT', v_actor_id, v_actor_role, to_jsonb(NEW));
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER audit_products_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row_change();

CREATE TRIGGER audit_profiles_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row_change();

CREATE TRIGGER audit_restaurant_settings_changes
  AFTER UPDATE ON public.restaurant_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row_change();

CREATE TRIGGER audit_payment_methods_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row_change();

CREATE TRIGGER audit_payments_changes
  AFTER INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row_change();

-- ============================================================================
-- Pedidos Flash — Migración 04: Funciones Helper de Seguridad y Políticas RLS
-- ============================================================================

-- 1. Funciones helper seguras (SECURITY DEFINER con search_path fijo)
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT p.role
  FROM public.profiles p
  WHERE p.id = (SELECT auth.uid())
    AND p.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(VARIADIC p_roles public.user_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT COALESCE(public.current_user_role() = ANY(p_roles), false);
$$;

CREATE OR REPLACE FUNCTION public.is_active_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT public.current_user_role() IS NOT NULL;
$$;

-- 2. Habilitar Row Level Security en TODAS las tablas canónicas
ALTER TABLE public.restaurant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dining_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comandas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comanda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Defensa en profundidad: revocar privilegios directos al rol anónimo y asegurar grants explícitos para roles autenticados
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- 3. Políticas RLS por tabla y rol (admin | mozo | cocina | caja)

-- 3.1 restaurant_settings
CREATE POLICY rls_restaurant_settings_select ON public.restaurant_settings
  FOR SELECT TO authenticated
  USING (public.is_active_staff());

CREATE POLICY rls_restaurant_settings_insert_admin ON public.restaurant_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role('admin'));

CREATE POLICY rls_restaurant_settings_update_admin ON public.restaurant_settings
  FOR UPDATE TO authenticated
  USING (public.has_any_role('admin'))
  WITH CHECK (public.has_any_role('admin'));

-- 3.2 profiles
CREATE POLICY rls_profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_active_staff() OR id = (SELECT auth.uid()));

CREATE POLICY rls_profiles_insert_admin ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role('admin'));

CREATE POLICY rls_profiles_update_admin ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_any_role('admin'))
  WITH CHECK (public.has_any_role('admin'));

-- 3.3 sectors
CREATE POLICY rls_sectors_select ON public.sectors
  FOR SELECT TO authenticated
  USING (public.is_active_staff());

CREATE POLICY rls_sectors_insert_admin ON public.sectors
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role('admin'));

CREATE POLICY rls_sectors_update_admin ON public.sectors
  FOR UPDATE TO authenticated
  USING (public.has_any_role('admin'))
  WITH CHECK (public.has_any_role('admin'));

-- 3.4 dining_tables (Admin edita maestros; cambios de estado operativo van vía RPC)
CREATE POLICY rls_dining_tables_select ON public.dining_tables
  FOR SELECT TO authenticated
  USING (public.is_active_staff());

CREATE POLICY rls_dining_tables_insert_admin ON public.dining_tables
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role('admin'));

CREATE POLICY rls_dining_tables_update_admin ON public.dining_tables
  FOR UPDATE TO authenticated
  USING (public.has_any_role('admin'))
  WITH CHECK (public.has_any_role('admin'));

-- 3.5 table_sessions (Escritura exclusiva mediante RPCs transaccionales)
CREATE POLICY rls_table_sessions_select ON public.table_sessions
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'caja')
    OR (
      public.has_any_role('mozo')
      AND (
        status IN ('abierta', 'pendiente_cobro')
        OR opened_by = (SELECT auth.uid())
        OR closed_at >= (now() - interval '24 hours')
      )
    )
    OR (
      public.has_any_role('cocina')
      AND (
        status IN ('abierta', 'pendiente_cobro')
        OR closed_at >= (now() - interval '24 hours')
      )
    )
  );

-- 3.6 categories
CREATE POLICY rls_categories_select ON public.categories
  FOR SELECT TO authenticated
  USING (public.is_active_staff());

CREATE POLICY rls_categories_insert_admin ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role('admin'));

CREATE POLICY rls_categories_update_admin ON public.categories
  FOR UPDATE TO authenticated
  USING (public.has_any_role('admin'))
  WITH CHECK (public.has_any_role('admin'));

-- 3.7 products (Admin CRUD maestro; Cocina cambia disponibilidad vía RPC toggle_product_availability)
CREATE POLICY rls_products_select ON public.products
  FOR SELECT TO authenticated
  USING (public.is_active_staff());

CREATE POLICY rls_products_insert_admin ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role('admin'));

CREATE POLICY rls_products_update_admin ON public.products
  FOR UPDATE TO authenticated
  USING (public.has_any_role('admin'))
  WITH CHECK (public.has_any_role('admin'));

-- 3.8 comandas & comanda_items (Escritura exclusiva mediante RPCs transaccionales)
CREATE POLICY rls_comandas_select ON public.comandas
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'caja')
    OR (
      public.has_any_role('cocina')
      AND (status <> 'entregado' OR created_at >= (now() - interval '24 hours'))
    )
    OR (
      public.has_any_role('mozo')
      AND (
        created_by = (SELECT auth.uid())
        OR created_at >= (now() - interval '24 hours')
        OR EXISTS (
          SELECT 1 FROM public.table_sessions ts
          WHERE ts.id = comandas.table_session_id
            AND ts.status IN ('abierta', 'pendiente_cobro')
        )
      )
    )
  );

CREATE POLICY rls_comanda_items_select ON public.comanda_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.comandas c
      WHERE c.id = comanda_items.comanda_id
    )
  );

-- 3.9 payment_methods & payments
CREATE POLICY rls_payment_methods_select ON public.payment_methods
  FOR SELECT TO authenticated
  USING (public.is_active_staff());

CREATE POLICY rls_payment_methods_insert_admin ON public.payment_methods
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role('admin'));

CREATE POLICY rls_payment_methods_update_admin ON public.payment_methods
  FOR UPDATE TO authenticated
  USING (public.has_any_role('admin'))
  WITH CHECK (public.has_any_role('admin'));

CREATE POLICY rls_payments_select ON public.payments
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'caja')
    OR (
      public.has_any_role('mozo')
      AND EXISTS (
        SELECT 1 FROM public.table_sessions ts
        WHERE ts.id = payments.table_session_id
          AND ts.status IN ('abierta', 'pendiente_cobro')
      )
    )
  );

-- 3.10 status_history & audit_logs (Append-only)
CREATE POLICY rls_status_history_select ON public.status_history
  FOR SELECT TO authenticated
  USING (
    public.has_any_role('admin', 'caja')
    OR (
      public.has_any_role('mozo', 'cocina')
      AND changed_at >= (now() - interval '24 hours')
    )
  );

CREATE POLICY rls_audit_logs_select_admin ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_any_role('admin'));

-- 3.11 push_subscriptions (Cada usuario gestiona sus suscripciones; Admin puede inspeccionarlas)
CREATE POLICY rls_push_subscriptions_select ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) AND public.is_active_staff())
    OR public.has_any_role('admin')
  );

CREATE POLICY rls_push_subscriptions_insert_own ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_active_staff());

CREATE POLICY rls_push_subscriptions_update_own ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.is_active_staff())
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_active_staff());

CREATE POLICY rls_push_subscriptions_delete_own ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) AND public.is_active_staff())
    OR public.has_any_role('admin')
  );

-- ============================================================================
-- Pedidos Flash — Migración 05: Funciones RPC Transaccionales (PL/pgSQL)
-- Compatibilidad 100% exacta con src/contracts/rpc.ts y src/contracts/domain.ts
-- Orden global de locks anti-deadlock: dining_tables -> table_sessions -> comandas -> products
-- ============================================================================

-- Helper interno: valida sesión autenticada y rol activo permitido
CREATE OR REPLACE FUNCTION public.assert_caller_role(VARIADIC p_allowed_roles public.user_role[])
RETURNS TABLE (actor_id uuid, actor_role public.user_role)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Debés iniciar sesión para realizar esta operación.'
      USING ERRCODE = '28000';
  END IF;

  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_uid AND p.is_active = true;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN_INACTIVE: Tu usuario no posee un perfil activo.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (v_role = ANY(p_allowed_roles)) THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE: El rol "%" no tiene permisos para esta acción.', v_role
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_uid, v_role;
END;
$$;

-- Helper interno: recalcula montos enteros (bigint) de una sesión bajo lock
CREATE OR REPLACE FUNCTION public.recalculate_table_session_totals(p_table_session_id uuid)
RETURNS public.table_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_items_subtotal bigint := 0;
  v_paid_sum bigint := 0;
  v_session public.table_sessions;
BEGIN
  SELECT COALESCE(SUM(ci.subtotal), 0)::bigint
  INTO v_items_subtotal
  FROM public.comandas c
  JOIN public.comanda_items ci ON ci.comanda_id = c.id
  WHERE c.table_session_id = p_table_session_id;

  SELECT COALESCE(SUM(p.amount), 0)::bigint
  INTO v_paid_sum
  FROM public.payments p
  WHERE p.table_session_id = p_table_session_id;

  UPDATE public.table_sessions
  SET subtotal_amount = v_items_subtotal,
      total_amount = v_items_subtotal,
      paid_amount = v_paid_sum,
      version = version + 1
  WHERE id = p_table_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. open_table_session(p_table_id, p_idempotency_key)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_table_session(
  p_table_id uuid,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor record;
  v_table public.dining_tables;
  v_session public.table_sessions;
  v_existing_table public.dining_tables;
  v_currency text;
BEGIN
  SELECT * INTO v_actor FROM public.assert_caller_role('admin', 'mozo');

  IF p_table_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGS: Se requieren p_table_id y p_idempotency_key válidos.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.in_transactional_rpc', 'on', true);

  -- Lock #1: dining_tables
  SELECT * INTO v_table
  FROM public.dining_tables
  WHERE id = p_table_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TABLE_NOT_FOUND: La mesa seleccionada no existe.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Verificación de idempotencia ante reintentos de red del mismo dispositivo
  SELECT * INTO v_session
  FROM public.table_sessions
  WHERE open_idempotency_key = p_idempotency_key;

  IF FOUND THEN
    SELECT * INTO v_existing_table
    FROM public.dining_tables
    WHERE id = v_session.table_id;

    RETURN jsonb_build_object(
      'session_id', v_session.id,
      'session_number', v_session.session_number,
      'table_id', v_session.table_id,
      'table_status', v_existing_table.status,
      'idempotent_replay', true
    );
  END IF;

  IF NOT v_table.is_active THEN
    RAISE EXCEPTION 'TABLE_INACTIVE: La mesa "%" está deshabilitada.', v_table.code
      USING ERRCODE = 'P0001';
  END IF;

  IF v_table.status <> 'libre' OR v_table.current_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'TABLE_ALREADY_OCCUPIED: La mesa "%" ya se encuentra ocupada.', v_table.code
      USING ERRCODE = '23505';
  END IF;

  SELECT rs.currency_code INTO v_currency
  FROM public.restaurant_settings rs
  WHERE rs.id = 1;

  INSERT INTO public.table_sessions (
    table_id,
    opened_by,
    status,
    currency_code,
    open_idempotency_key
  )
  VALUES (
    v_table.id,
    v_actor.actor_id,
    'abierta',
    COALESCE(v_currency, 'PYG'),
    p_idempotency_key
  )
  RETURNING * INTO v_session;

  UPDATE public.dining_tables
  SET status = 'ocupada',
      current_session_id = v_session.id
  WHERE id = v_table.id
  RETURNING * INTO v_table;

  INSERT INTO public.status_history (entity_type, entity_id, from_status, to_status, changed_by, metadata)
  VALUES
    ('dining_table', v_table.id, 'libre', 'ocupada', v_actor.actor_id, jsonb_build_object('session_id', v_session.id)),
    ('table_session', v_session.id, NULL, 'abierta', v_actor.actor_id, jsonb_build_object('table_code', v_table.code));

  INSERT INTO public.audit_logs (table_name, record_id, action, actor_id, actor_role, new_data)
  VALUES ('table_sessions', v_session.id::text, 'RPC', v_actor.actor_id, v_actor.actor_role, to_jsonb(v_session));

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'session_number', v_session.session_number,
    'table_id', v_table.id,
    'table_status', v_table.status,
    'idempotent_replay', false
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. create_comanda_idempotent(...)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_comanda_idempotent(
  p_table_session_id uuid,
  p_idempotency_key uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_comanda_type public.comanda_type DEFAULT 'original',
  p_parent_comanda_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor record;
  v_session public.table_sessions;
  v_existing_comanda public.comandas;
  v_new_comanda public.comandas;
  v_effective_type public.comanda_type;
  v_effective_parent_id uuid := p_parent_comanda_id;
  v_clean_notes text := NULLIF(btrim(p_notes), '');
  v_item record;
  v_product public.products;
BEGIN
  SELECT * INTO v_actor FROM public.assert_caller_role('admin', 'mozo');

  IF p_table_session_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGS: Se requieren p_table_session_id y p_idempotency_key.'
      USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_COMANDA_ITEMS: Debés agregar al menos un producto a la comanda.'
      USING ERRCODE = '22023';
  END IF;

  -- Lock #2: table_sessions (serializa envíos concurrentes y reintentos sobre la misma cuenta)
  SELECT * INTO v_session
  FROM public.table_sessions
  WHERE id = p_table_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND: La sesión de mesa indicada no existe.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Verificación idempotente segura bajo lock
  SELECT * INTO v_existing_comanda
  FROM public.comandas
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'comanda_id', v_existing_comanda.id,
      'comanda_number', v_existing_comanda.comanda_number,
      'status', v_existing_comanda.status,
      'session_total_amount', v_session.total_amount,
      'idempotent_replay', true
    );
  END IF;

  IF v_session.status <> 'abierta' THEN
    RAISE EXCEPTION 'SESSION_NOT_OPEN: La sesión de mesa está en estado "%" y no admite nuevas comandas.',
      v_session.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Normalización de tipo de comanda y validación de referencia padre
  IF COALESCE(p_comanda_type, 'original') = 'correccion' THEN
    v_effective_type := 'correccion';
    IF v_effective_parent_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.comandas c
        WHERE c.id = v_effective_parent_id AND c.table_session_id = v_session.id
      ) THEN
        RAISE EXCEPTION 'PARENT_COMANDA_INVALID: La comanda original indicada no pertenece a esta sesión de mesa.'
          USING ERRCODE = 'P0002';
      END IF;
    ELSE
      SELECT c.id INTO v_effective_parent_id
      FROM public.comandas c
      WHERE c.table_session_id = v_session.id
      ORDER BY c.created_at DESC
      LIMIT 1;
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.comandas c WHERE c.table_session_id = v_session.id) THEN
      v_effective_type := 'adicion';
    ELSE
      v_effective_type := 'original';
    END IF;
  END IF;

  -- Lock #4: products ordenados por ID ASC para evitar interbloqueos y congelar precio/disponibilidad
  PERFORM 1
  FROM public.products pr
  WHERE pr.id IN (
    SELECT DISTINCT (elem->>'product_id')::uuid
    FROM jsonb_array_elements(p_items) AS elem
  )
  ORDER BY pr.id ASC
  FOR SHARE;

  INSERT INTO public.comandas (
    table_session_id,
    table_id,
    created_by,
    status,
    comanda_type,
    parent_comanda_id,
    idempotency_key,
    notes
  )
  VALUES (
    v_session.id,
    v_session.table_id,
    v_actor.actor_id,
    'nuevo',
    v_effective_type,
    v_effective_parent_id,
    p_idempotency_key,
    v_clean_notes
  )
  RETURNING * INTO v_new_comanda;

  FOR v_item IN
    SELECT
      (elem->>'product_id')::uuid AS product_id,
      (elem->>'quantity')::integer AS quantity,
      COALESCE(
        NULLIF(btrim(elem->>'special_instructions'), ''),
        NULLIF(btrim(elem->>'special_notes'), '')
      ) AS special_instructions
    FROM jsonb_array_elements(p_items) AS elem
  LOOP
    IF v_item.product_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity < 1 OR v_item.quantity > 999 THEN
      RAISE EXCEPTION 'INVALID_COMANDA_ITEM: Cantidad o producto inválido en la comanda.'
        USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_item.product_id;

    IF NOT FOUND OR NOT v_product.is_active THEN
      RAISE EXCEPTION 'PRODUCT_INACTIVE: El producto seleccionado no existe o está inactivo.'
        USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_product.is_available THEN
      RAISE EXCEPTION 'PRODUCT_UNAVAILABLE: El producto "%" está marcado como agotado.',
        v_product.name
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.comanda_items (
      comanda_id,
      product_id,
      product_name_snapshot,
      unit_price_snapshot,
      quantity,
      special_instructions
    )
    VALUES (
      v_new_comanda.id,
      v_product.id,
      v_product.name,
      v_product.price_amount,
      v_item.quantity,
      v_item.special_instructions
    );
  END LOOP;

  v_session := public.recalculate_table_session_totals(v_session.id);

  INSERT INTO public.status_history (entity_type, entity_id, from_status, to_status, changed_by, metadata)
  VALUES (
    'comanda',
    v_new_comanda.id,
    NULL,
    'nuevo',
    v_actor.actor_id,
    jsonb_build_object(
      'comanda_number', v_new_comanda.comanda_number,
      'comanda_type', v_new_comanda.comanda_type,
      'parent_comanda_id', v_new_comanda.parent_comanda_id
    )
  );

  INSERT INTO public.audit_logs (table_name, record_id, action, actor_id, actor_role, new_data)
  VALUES ('comandas', v_new_comanda.id::text, 'RPC', v_actor.actor_id, v_actor.actor_role, to_jsonb(v_new_comanda));

  RETURN jsonb_build_object(
    'comanda_id', v_new_comanda.id,
    'comanda_number', v_new_comanda.comanda_number,
    'status', v_new_comanda.status,
    'session_total_amount', v_session.total_amount,
    'idempotent_replay', false
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. advance_comanda_status(p_comanda_id, p_target_status)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_comanda_status(
  p_comanda_id uuid,
  p_target_status public.comanda_status
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor record;
  v_comanda public.comandas;
  v_prev_status public.comanda_status;
  v_table_code text;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_actor FROM public.assert_caller_role('admin', 'cocina', 'mozo');

  -- Lock #3: comandas
  SELECT * INTO v_comanda
  FROM public.comandas
  WHERE id = p_comanda_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMANDA_NOT_FOUND: La comanda indicada no existe.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT dt.code INTO v_table_code
  FROM public.dining_tables dt
  WHERE dt.id = v_comanda.table_id;

  -- Idempotencia ante toques simultáneos en múltiples pantallas KDS / móviles
  IF v_comanda.status = p_target_status THEN
    RETURN jsonb_build_object(
      'comanda_id', v_comanda.id,
      'comanda_number', v_comanda.comanda_number,
      'table_id', v_comanda.table_id,
      'table_code', v_table_code,
      'previous_status', v_comanda.status,
      'new_status', v_comanda.status,
      'created_by', v_comanda.created_by,
      'already_in_status', true
    );
  END IF;

  v_prev_status := v_comanda.status;

  -- Validación de rol según etapa (alineado con canTransitionComandaStatus en domain.ts)
  IF p_target_status = 'entregado' THEN
    IF v_actor.actor_role NOT IN ('mozo', 'cocina', 'admin') THEN
      RAISE EXCEPTION 'FORBIDDEN_ROLE: No tenés permiso para marcar la comanda como entregada.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_actor.actor_role NOT IN ('cocina', 'admin') THEN
      RAISE EXCEPTION 'FORBIDDEN_KDS_TRANSITION: Solo Cocina o Administración pueden pasar una comanda a "%".',
        p_target_status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Validación exacta de VALID_COMANDA_TRANSITIONS (domain.ts)
  IF NOT (
    (v_prev_status = 'nuevo' AND p_target_status IN ('recibido', 'preparando'))
    OR (v_prev_status = 'recibido' AND p_target_status IN ('preparando', 'listo'))
    OR (v_prev_status = 'preparando' AND p_target_status = 'listo')
    OR (v_prev_status = 'listo' AND p_target_status = 'entregado')
  ) THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: No se puede pasar la comanda #% de "%" a "%".',
      v_comanda.comanda_number, v_prev_status, p_target_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.comandas
  SET status = p_target_status,
      received_at = CASE
        WHEN p_target_status IN ('recibido', 'preparando', 'listo') THEN COALESCE(received_at, v_now)
        ELSE received_at
      END,
      preparing_at = CASE
        WHEN p_target_status IN ('preparando', 'listo') THEN COALESCE(preparing_at, v_now)
        ELSE preparing_at
      END,
      ready_at = CASE
        WHEN p_target_status = 'listo' THEN COALESCE(ready_at, v_now)
        ELSE ready_at
      END,
      delivered_at = CASE
        WHEN p_target_status = 'entregado' THEN COALESCE(delivered_at, v_now)
        ELSE delivered_at
      END,
      version = version + 1
  WHERE id = v_comanda.id
  RETURNING * INTO v_comanda;

  INSERT INTO public.status_history (entity_type, entity_id, from_status, to_status, changed_by, metadata)
  VALUES (
    'comanda',
    v_comanda.id,
    v_prev_status::text,
    p_target_status::text,
    v_actor.actor_id,
    jsonb_build_object('comanda_number', v_comanda.comanda_number, 'table_code', v_table_code)
  );

  RETURN jsonb_build_object(
    'comanda_id', v_comanda.id,
    'comanda_number', v_comanda.comanda_number,
    'table_id', v_comanda.table_id,
    'table_code', v_table_code,
    'previous_status', v_prev_status,
    'new_status', v_comanda.status,
    'created_by', v_comanda.created_by,
    'already_in_status', false
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. request_table_bill(p_table_session_id, p_force)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_table_bill(
  p_table_session_id uuid,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor record;
  v_table_id uuid;
  v_table public.dining_tables;
  v_session public.table_sessions;
  v_pending_kitchen_count integer := 0;
BEGIN
  SELECT * INTO v_actor FROM public.assert_caller_role('admin', 'mozo', 'caja');

  SELECT ts.table_id INTO v_table_id
  FROM public.table_sessions ts
  WHERE ts.id = p_table_session_id;

  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND: La sesión de mesa no existe.'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.in_transactional_rpc', 'on', true);

  -- Locks en orden jerárquico: 1) dining_tables -> 2) table_sessions
  SELECT * INTO v_table FROM public.dining_tables WHERE id = v_table_id FOR UPDATE;
  SELECT * INTO v_session FROM public.table_sessions WHERE id = p_table_session_id FOR UPDATE;

  IF v_session.status = 'cerrada' THEN
    RAISE EXCEPTION 'SESSION_ALREADY_CLOSED: Esta cuenta ya fue cerrada.'
      USING ERRCODE = 'P0001';
  END IF;

  v_session := public.recalculate_table_session_totals(v_session.id);

  IF v_session.total_amount <= 0 THEN
    RAISE EXCEPTION 'EMPTY_BILL: La mesa no posee consumos registrados. Si fue abierta por error, usá cerrar mesa sin consumo.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT COALESCE(p_force, false) THEN
    SELECT COUNT(*) INTO v_pending_kitchen_count
    FROM public.comandas c
    WHERE c.table_session_id = v_session.id
      AND c.status IN ('nuevo', 'recibido', 'preparando');

    IF v_pending_kitchen_count > 0 THEN
      RAISE EXCEPTION 'PENDING_KDS_COMANDAS: Hay % comanda(s) todavía pendientes en cocina.',
        v_pending_kitchen_count
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_session.status = 'abierta' THEN
    UPDATE public.table_sessions
    SET status = 'pendiente_cobro',
        version = version + 1
    WHERE id = v_session.id
    RETURNING * INTO v_session;

    UPDATE public.dining_tables
    SET status = 'pendiente_cobro'
    WHERE id = v_table.id
    RETURNING * INTO v_table;

    INSERT INTO public.status_history (entity_type, entity_id, from_status, to_status, changed_by, metadata)
    VALUES
      ('table_session', v_session.id, 'abierta', 'pendiente_cobro', v_actor.actor_id, jsonb_build_object('total_amount', v_session.total_amount)),
      ('dining_table', v_table.id, 'ocupada', 'pendiente_cobro', v_actor.actor_id, jsonb_build_object('session_id', v_session.id));
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'table_id', v_table.id,
    'session_status', v_session.status,
    'table_status', v_table.status,
    'total_amount', v_session.total_amount,
    'balance_due', v_session.balance_due
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. register_payment_and_close_table(...)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_payment_and_close_table(
  p_table_session_id uuid,
  p_payment_method_id uuid,
  p_amount bigint,
  p_idempotency_key uuid,
  p_amount_tendered bigint DEFAULT NULL,
  p_reference_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor record;
  v_table_id uuid;
  v_table public.dining_tables;
  v_session public.table_sessions;
  v_method public.payment_methods;
  v_existing_payment public.payments;
  v_new_payment public.payments;
  v_effective_tendered bigint := NULL;
  v_change_amount bigint := 0;
  v_clean_ref text := NULLIF(btrim(p_reference_code), '');
  v_prev_session_status public.session_status;
  v_prev_table_status public.table_status;
  v_session_closed boolean := false;
BEGIN
  SELECT * INTO v_actor FROM public.assert_caller_role('admin', 'caja');

  IF p_table_session_id IS NULL OR p_payment_method_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGS: Faltan identificadores requeridos para registrar el pago.'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_AMOUNT: El monto del pago debe ser mayor a cero.'
      USING ERRCODE = '22023';
  END IF;

  SELECT ts.table_id INTO v_table_id
  FROM public.table_sessions ts
  WHERE ts.id = p_table_session_id;

  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND: La sesión de mesa indicada no existe.'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.in_transactional_rpc', 'on', true);

  -- Locks en orden jerárquico: 1) dining_tables -> 2) table_sessions
  SELECT * INTO v_table FROM public.dining_tables WHERE id = v_table_id FOR UPDATE;
  SELECT * INTO v_session FROM public.table_sessions WHERE id = p_table_session_id FOR UPDATE;

  -- Idempotencia bajo lock contra doble cobro
  SELECT * INTO v_existing_payment
  FROM public.payments
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'payment_id', v_existing_payment.id,
      'session_id', v_session.id,
      'table_id', v_table.id,
      'paid_amount', v_session.paid_amount,
      'balance_due', v_session.balance_due,
      'change_amount', v_existing_payment.change_amount,
      'session_closed', (v_session.status = 'cerrada'),
      'table_status', v_table.status,
      'idempotent_replay', true
    );
  END IF;

  IF v_session.status = 'cerrada' THEN
    RAISE EXCEPTION 'SESSION_ALREADY_CLOSED: La cuenta ya se encuentra pagada y cerrada.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_method
  FROM public.payment_methods
  WHERE id = p_payment_method_id;

  IF NOT FOUND OR NOT v_method.is_active THEN
    RAISE EXCEPTION 'PAYMENT_METHOD_INACTIVE: El método de pago seleccionado no está disponible.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_method.requires_reference AND v_clean_ref IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_REFERENCE_REQUIRED: El medio "%" requiere número de referencia o comprobante.',
      v_method.name
      USING ERRCODE = '22023';
  END IF;

  v_session := public.recalculate_table_session_totals(v_session.id);

  IF v_session.total_amount <= 0 THEN
    RAISE EXCEPTION 'EMPTY_BILL: La sesión no tiene cargos pendientes de cobro.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_amount > v_session.balance_due THEN
    RAISE EXCEPTION 'AMOUNT_EXCEEDS_BALANCE: El monto ingresado (%) supera el saldo pendiente (%).',
      p_amount, v_session.balance_due
      USING ERRCODE = '22003';
  END IF;

  -- Normalización de efectivo recibido y vuelto
  IF v_method.is_cash THEN
    IF p_amount_tendered IS NULL OR p_amount_tendered = 0 THEN
      v_effective_tendered := p_amount;
      v_change_amount := 0;
    ELSIF p_amount_tendered < p_amount THEN
      RAISE EXCEPTION 'INSUFFICIENT_TENDERED_AMOUNT: El efectivo recibido (%) es menor al monto a cobrar (%).',
        p_amount_tendered, p_amount
        USING ERRCODE = '22023';
    ELSE
      v_effective_tendered := p_amount_tendered;
      v_change_amount := p_amount_tendered - p_amount;
    END IF;
  ELSE
    v_effective_tendered := NULL;
    v_change_amount := 0;
  END IF;

  v_prev_session_status := v_session.status;
  v_prev_table_status := v_table.status;

  INSERT INTO public.payments (
    table_session_id,
    payment_method_id,
    amount,
    amount_tendered,
    change_amount,
    currency_code,
    reference_code,
    idempotency_key,
    cashier_id
  )
  VALUES (
    v_session.id,
    v_method.id,
    p_amount,
    v_effective_tendered,
    v_change_amount,
    v_session.currency_code,
    v_clean_ref,
    p_idempotency_key,
    v_actor.actor_id
  )
  RETURNING * INTO v_new_payment;

  v_session := public.recalculate_table_session_totals(v_session.id);

  IF v_session.balance_due = 0 THEN
    UPDATE public.table_sessions
    SET status = 'cerrada',
        closed_by = v_actor.actor_id,
        closed_at = now(),
        version = version + 1
    WHERE id = v_session.id
    RETURNING * INTO v_session;

    UPDATE public.dining_tables
    SET status = 'libre',
        current_session_id = NULL
    WHERE id = v_table.id
    RETURNING * INTO v_table;

    v_session_closed := true;

    INSERT INTO public.status_history (entity_type, entity_id, from_status, to_status, changed_by, metadata)
    VALUES
      ('payment', v_new_payment.id, NULL, 'completado', v_actor.actor_id, jsonb_build_object('amount', p_amount, 'method', v_method.code)),
      ('table_session', v_session.id, v_prev_session_status::text, 'cerrada', v_actor.actor_id, jsonb_build_object('paid_amount', v_session.paid_amount)),
      ('dining_table', v_table.id, v_prev_table_status::text, 'libre', v_actor.actor_id, jsonb_build_object('closed_session_id', v_session.id));
  ELSE
    IF v_session.status = 'abierta' THEN
      UPDATE public.table_sessions
      SET status = 'pendiente_cobro',
          version = version + 1
      WHERE id = v_session.id
      RETURNING * INTO v_session;

      UPDATE public.dining_tables
      SET status = 'pendiente_cobro'
      WHERE id = v_table.id
      RETURNING * INTO v_table;
    END IF;

    INSERT INTO public.status_history (entity_type, entity_id, from_status, to_status, changed_by, metadata)
    VALUES
      ('payment', v_new_payment.id, NULL, 'completado', v_actor.actor_id, jsonb_build_object('amount', p_amount, 'balance_due', v_session.balance_due));
  END IF;

  RETURN jsonb_build_object(
    'payment_id', v_new_payment.id,
    'session_id', v_session.id,
    'table_id', v_table.id,
    'paid_amount', v_session.paid_amount,
    'balance_due', v_session.balance_due,
    'change_amount', v_new_payment.change_amount,
    'session_closed', v_session_closed,
    'table_status', v_table.status,
    'idempotent_replay', false
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. toggle_product_availability(p_product_id, p_is_available)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toggle_product_availability(
  p_product_id uuid,
  p_is_available boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor record;
  v_product public.products;
BEGIN
  SELECT * INTO v_actor FROM public.assert_caller_role('admin', 'cocina');

  UPDATE public.products
  SET is_available = p_is_available
  WHERE id = p_product_id AND is_active = true
  RETURNING * INTO v_product;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: El producto no existe o se encuentra inactivo.'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'product_id', v_product.id,
    'is_available', v_product.is_available
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. cancel_empty_table_session(p_table_session_id)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_empty_table_session(
  p_table_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor record;
  v_table_id uuid;
  v_table public.dining_tables;
  v_session public.table_sessions;
  v_prev_session_status public.session_status;
  v_prev_table_status public.table_status;
BEGIN
  SELECT * INTO v_actor FROM public.assert_caller_role('admin', 'mozo', 'caja');

  SELECT ts.table_id INTO v_table_id
  FROM public.table_sessions ts
  WHERE ts.id = p_table_session_id;

  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND: La sesión de mesa no existe.'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.in_transactional_rpc', 'on', true);

  -- Locks en orden jerárquico: 1) dining_tables -> 2) table_sessions
  SELECT * INTO v_table FROM public.dining_tables WHERE id = v_table_id FOR UPDATE;
  SELECT * INTO v_session FROM public.table_sessions WHERE id = p_table_session_id FOR UPDATE;

  IF v_session.status = 'cerrada' THEN
    RETURN jsonb_build_object(
      'session_id', v_session.id,
      'table_id', v_table.id,
      'session_status', v_session.status,
      'table_status', v_table.status
    );
  END IF;

  v_session := public.recalculate_table_session_totals(v_session.id);

  IF v_session.total_amount > 0 OR v_session.paid_amount > 0
     OR EXISTS (SELECT 1 FROM public.comandas c WHERE c.table_session_id = v_session.id) THEN
    RAISE EXCEPTION 'SESSION_NOT_EMPTY: No se puede anular una sesión que ya registra comandas o pagos.'
      USING ERRCODE = 'P0001';
  END IF;

  v_prev_session_status := v_session.status;
  v_prev_table_status := v_table.status;

  UPDATE public.table_sessions
  SET status = 'cerrada',
      closed_by = v_actor.actor_id,
      closed_at = now(),
      version = version + 1
  WHERE id = v_session.id
  RETURNING * INTO v_session;

  UPDATE public.dining_tables
  SET status = 'libre',
      current_session_id = NULL
  WHERE id = v_table.id
  RETURNING * INTO v_table;

  INSERT INTO public.status_history (entity_type, entity_id, from_status, to_status, changed_by, metadata)
  VALUES
    ('table_session', v_session.id, v_prev_session_status::text, 'cerrada', v_actor.actor_id, jsonb_build_object('reason', 'empty_cancel')),
    ('dining_table', v_table.id, v_prev_table_status::text, 'libre', v_actor.actor_id, jsonb_build_object('cancelled_session_id', v_session.id));

  INSERT INTO public.audit_logs (table_name, record_id, action, actor_id, actor_role, new_data)
  VALUES ('table_sessions', v_session.id::text, 'RPC', v_actor.actor_id, v_actor.actor_role, to_jsonb(v_session));

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'table_id', v_table.id,
    'session_status', v_session.status,
    'table_status', v_table.status
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- Permisos explícitos de ejecución
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.assert_caller_role(public.user_role[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_table_session_totals(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.open_table_session(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_table_session(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_comanda_idempotent(uuid, uuid, jsonb, text, public.comanda_type, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_comanda_idempotent(uuid, uuid, jsonb, text, public.comanda_type, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.advance_comanda_status(uuid, public.comanda_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_comanda_status(uuid, public.comanda_status) TO authenticated;

REVOKE ALL ON FUNCTION public.request_table_bill(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_table_bill(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.register_payment_and_close_table(uuid, uuid, bigint, uuid, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_payment_and_close_table(uuid, uuid, bigint, uuid, bigint, text) TO authenticated;

REVOKE ALL ON FUNCTION public.toggle_product_availability(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_product_availability(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_empty_table_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_empty_table_session(uuid) TO authenticated;

-- ============================================================================
-- Pedidos Flash — Migración 06: Vistas Operativas (security_invoker) y Realtime
-- Columnas 100% alineadas con FloorTableView y KdsQueueComanda (domain.ts)
-- ============================================================================

-- 1. Vista del Mapa de Salón (FloorTableView)
CREATE OR REPLACE VIEW public.v_floor_tables
WITH (security_invoker = true)
AS
SELECT
  dt.id,
  dt.code,
  dt.name,
  dt.sector_id,
  dt.capacity,
  dt.status,
  dt.current_session_id,
  dt.sort_order,
  dt.is_active,
  s.name AS sector_name,
  ts.session_number,
  ts.opened_at AS session_opened_at,
  pr.full_name AS opened_by_name,
  COALESCE(ts.total_amount, 0)::bigint AS total_amount,
  COALESCE(ts.paid_amount, 0)::bigint AS paid_amount,
  COALESCE(ts.balance_due, 0)::bigint AS balance_due,
  COALESCE(c_stats.active_comandas_count, 0)::integer AS active_comandas_count,
  COALESCE(c_stats.ready_comandas_count, 0)::integer AS ready_comandas_count
FROM public.dining_tables dt
JOIN public.sectors s ON s.id = dt.sector_id
LEFT JOIN public.table_sessions ts ON ts.id = dt.current_session_id
LEFT JOIN public.profiles pr ON pr.id = ts.opened_by
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE c.status <> 'entregado') AS active_comandas_count,
    COUNT(*) FILTER (WHERE c.status = 'listo') AS ready_comandas_count
  FROM public.comandas c
  WHERE c.table_session_id = ts.id
) c_stats ON ts.id IS NOT NULL
WHERE dt.is_active = true
  AND s.is_active = true
ORDER BY s.sort_order ASC, dt.sort_order ASC, dt.code ASC;

-- 2. Vista de Cola KDS de Cocina (KdsQueueComanda)
CREATE OR REPLACE VIEW public.v_kds_queue
WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.comanda_number,
  c.table_session_id,
  c.table_id,
  c.created_by,
  c.status,
  c.comanda_type,
  c.parent_comanda_id,
  c.idempotency_key,
  c.notes,
  c.version,
  c.created_at,
  c.received_at,
  c.preparing_at,
  c.ready_at,
  c.delivered_at,
  dt.code AS table_code,
  s.name AS sector_name,
  pr.full_name AS waiter_name,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', ci.id,
        'comanda_id', ci.comanda_id,
        'product_id', ci.product_id,
        'product_name_snapshot', ci.product_name_snapshot,
        'unit_price_snapshot', ci.unit_price_snapshot,
        'quantity', ci.quantity,
        'special_instructions', ci.special_instructions,
        'subtotal', ci.subtotal
      )
      ORDER BY ci.id ASC
    ) FILTER (WHERE ci.id IS NOT NULL),
    '[]'::jsonb
  ) AS items
FROM public.comandas c
JOIN public.dining_tables dt ON dt.id = c.table_id
JOIN public.sectors s ON s.id = dt.sector_id
JOIN public.profiles pr ON pr.id = c.created_by
LEFT JOIN public.comanda_items ci ON ci.comanda_id = c.id
WHERE c.status IN ('nuevo', 'recibido', 'preparando', 'listo')
GROUP BY
  c.id,
  dt.code,
  s.name,
  pr.full_name
ORDER BY c.created_at ASC;

REVOKE ALL ON public.v_floor_tables FROM anon;
REVOKE ALL ON public.v_kds_queue FROM anon;
GRANT SELECT ON public.v_floor_tables TO authenticated;
GRANT SELECT ON public.v_kds_queue TO authenticated;

-- 3. Configuración base singleton por defecto (idempotente)
INSERT INTO public.restaurant_settings (
  id,
  business_name,
  slogan,
  currency_code,
  currency_decimals,
  tax_percentage,
  kds_warn_minutes,
  kds_critical_minutes,
  sound_alerts_default
)
VALUES (
  1,
  'Pedidos Flash',
  'De la mesa a la cocina, en un flash.',
  'PYG',
  0,
  10.00,
  10,
  20,
  true
)
ON CONFLICT (id) DO NOTHING;

-- 4. Publicación Supabase Realtime sobre tablas operativas en vivo
DO $$
DECLARE
  v_tbl text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_tbl IN ARRAY ARRAY['dining_tables', 'table_sessions', 'comandas', 'products', 'payments']
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = v_tbl
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tbl);
      END IF;
    END LOOP;
  END IF;
END;
$$;

