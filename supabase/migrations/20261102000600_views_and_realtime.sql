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
