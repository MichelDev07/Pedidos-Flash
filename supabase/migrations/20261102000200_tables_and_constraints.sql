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
