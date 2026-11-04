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
