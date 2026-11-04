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
