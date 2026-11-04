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
