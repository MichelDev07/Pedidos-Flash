-- ============================================================================
-- Pedidos Flash — Seed Inicial Reproducible (Desarrollo Local y Pruebas E2E)
-- Moneda: PYG (Guaraníes enteros sin decimales)
-- Contraseña común de usuarios de prueba: Flash123!
-- ============================================================================

SET search_path = public, extensions;

BEGIN;

-- 1. Configuración general del restaurante (Singleton id = 1)
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
ON CONFLICT (id) DO UPDATE SET
  business_name = EXCLUDED.business_name,
  slogan = EXCLUDED.slogan,
  currency_code = EXCLUDED.currency_code,
  currency_decimals = EXCLUDED.currency_decimals,
  tax_percentage = EXCLUDED.tax_percentage,
  kds_warn_minutes = EXCLUDED.kds_warn_minutes,
  kds_critical_minutes = EXCLUDED.kds_critical_minutes,
  sound_alerts_default = EXCLUDED.sound_alerts_default;

-- 2. Usuarios locales de prueba en GoTrue v2 (auth.users + auth.identities + public.profiles)
-- Todos los campos string token se inicializan en '' (no NULL) para compatibilidad estricta con GoTrue v2.
DO $$
DECLARE
  v_pw_hash text := crypt('Flash123!', gen_salt('bf'));
  v_now timestamptz := now();
  v_user record;
BEGIN
  FOR v_user IN
    SELECT *
    FROM (
      VALUES
        ('11111111-1111-4111-8111-111111111101'::uuid, 'admin@pedidosflash.local',  'Administrador General', 'admin'::public.user_role),
        ('11111111-1111-4111-8111-111111111102'::uuid, 'mozo@pedidosflash.local',   'Carlos Gómez',          'mozo'::public.user_role),
        ('11111111-1111-4111-8111-111111111103'::uuid, 'mozo2@pedidosflash.local',  'Laura Benítez',         'mozo'::public.user_role),
        ('11111111-1111-4111-8111-111111111104'::uuid, 'cocina@pedidosflash.local', 'Jefe de Cocina',        'cocina'::public.user_role),
        ('11111111-1111-4111-8111-111111111105'::uuid, 'caja@pedidosflash.local',   'Ana Villalba',          'caja'::public.user_role)
    ) AS t(id, email, full_name, app_role)
  LOOP
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      email_change_token_current,
      recovery_token,
      phone_change,
      phone_change_token,
      reauthentication_token,
      is_sso_user,
      is_anonymous
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000'::uuid,
      v_user.id,
      'authenticated',
      'authenticated',
      v_user.email,
      v_pw_hash,
      v_now,
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'role', v_user.app_role::text,
        'full_name', v_user.full_name,
        'is_active', true
      ),
      jsonb_build_object(
        'sub', v_user.id::text,
        'email', v_user.email,
        'full_name', v_user.full_name,
        'email_verified', true,
        'phone_verified', false
      ),
      false,
      v_now,
      v_now,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      false,
      false
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      encrypted_password = EXCLUDED.encrypted_password,
      email_confirmed_at = EXCLUDED.email_confirmed_at,
      raw_app_meta_data = EXCLUDED.raw_app_meta_data,
      raw_user_meta_data = EXCLUDED.raw_user_meta_data,
      confirmation_token = '',
      email_change = '',
      email_change_token_new = '',
      email_change_token_current = '',
      recovery_token = '',
      phone_change = '',
      phone_change_token = '',
      reauthentication_token = '',
      updated_at = v_now;

    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    )
    VALUES (
      v_user.id,
      v_user.id,
      jsonb_build_object(
        'sub', v_user.id::text,
        'email', v_user.email,
        'full_name', v_user.full_name,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      v_user.id::text,
      v_now,
      v_now,
      v_now
    )
    ON CONFLICT (id) DO UPDATE SET
      identity_data = EXCLUDED.identity_data,
      updated_at = v_now;

    -- Asegurar consistencia explícita del perfil público
    INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (v_user.id, v_user.email, v_user.full_name, v_user.app_role, true)
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      is_active = true;
  END LOOP;
END;
$$;

-- 3. Sectores (3 sectores)
INSERT INTO public.sectors (id, name, sort_order, is_active)
VALUES
  ('22222222-2222-4222-8222-222222222201'::uuid, 'Salón Principal', 1, true),
  ('22222222-2222-4222-8222-222222222202'::uuid, 'Terraza',         2, true),
  ('22222222-2222-4222-8222-222222222203'::uuid, 'Barra',           3, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

-- 4. Mesas operativas (10 mesas: M1..M10)
INSERT INTO public.dining_tables (id, code, name, sector_id, capacity, sort_order, is_active)
VALUES
  ('33333333-3333-4333-8333-333333333301'::uuid, 'M1',  'Mesa 1 · Ventana',       '22222222-2222-4222-8222-222222222201'::uuid, 4,  1, true),
  ('33333333-3333-4333-8333-333333333302'::uuid, 'M2',  'Mesa 2 · Salón Centro',  '22222222-2222-4222-8222-222222222201'::uuid, 4,  2, true),
  ('33333333-3333-4333-8333-333333333303'::uuid, 'M3',  'Mesa 3 · Pareja',        '22222222-2222-4222-8222-222222222201'::uuid, 2,  3, true),
  ('33333333-3333-4333-8333-333333333304'::uuid, 'M4',  'Mesa 4 · Familiar',      '22222222-2222-4222-8222-222222222201'::uuid, 6,  4, true),
  ('33333333-3333-4333-8333-333333333305'::uuid, 'M5',  'Mesa 5 · Grupal',        '22222222-2222-4222-8222-222222222201'::uuid, 8,  5, true),
  ('33333333-3333-4333-8333-333333333306'::uuid, 'M6',  'Mesa 6 · Terraza Norte', '22222222-2222-4222-8222-222222222202'::uuid, 4,  6, true),
  ('33333333-3333-4333-8333-333333333307'::uuid, 'M7',  'Mesa 7 · Terraza Sur',   '22222222-2222-4222-8222-222222222202'::uuid, 4,  7, true),
  ('33333333-3333-4333-8333-333333333308'::uuid, 'M8',  'Mesa 8 · Deck Jardín',   '22222222-2222-4222-8222-222222222202'::uuid, 6,  8, true),
  ('33333333-3333-4333-8333-333333333309'::uuid, 'M9',  'Barra 1 · Esquina',      '22222222-2222-4222-8222-222222222203'::uuid, 2,  9, true),
  ('33333333-3333-4333-8333-333333333310'::uuid, 'M10', 'Barra 2 · Central',      '22222222-2222-4222-8222-222222222203'::uuid, 2, 10, true)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  sector_id = EXCLUDED.sector_id,
  capacity = EXCLUDED.capacity,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

-- 5. Categorías del menú (4 categorías)
INSERT INTO public.categories (id, name, slug, sort_order, is_active)
VALUES
  ('44444444-4444-4444-8444-444444444401'::uuid, 'Comidas',     'comidas',     1, true),
  ('44444444-4444-4444-8444-444444444402'::uuid, 'Bebidas',     'bebidas',     2, true),
  ('44444444-4444-4444-8444-444444444403'::uuid, 'Postres',     'postres',     3, true),
  ('44444444-4444-4444-8444-444444444404'::uuid, 'Adicionales', 'adicionales', 4, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

-- 6. Productos gastronómicos en PYG enteros (16 productos, incluyendo 1 agotado)
INSERT INTO public.products (id, category_id, name, description, price_amount, image_url, is_available, is_active)
VALUES
  -- Comidas (6)
  ('55555555-5555-4555-8555-555555555501'::uuid, '44444444-4444-4444-8444-444444444401'::uuid,
   'Lomito Completo Árabe', 'Pan árabe tostado, lomito vacuno, queso mozzarella, jamón, huevo, vegetales y salsa de ajo.', 38000, NULL, true, true),
  ('55555555-5555-4555-8555-555555555502'::uuid, '44444444-4444-4444-8444-444444444401'::uuid,
   'Bife Koygua con Mandioca', 'Bife de chorizo jugoso a la olla con cebolla, tomate, locote, dos huevos a caballo y mandioca caliente.', 58000, NULL, true, true),
  ('55555555-5555-4555-8555-555555555503'::uuid, '44444444-4444-4444-8444-444444444401'::uuid,
   'Milanesa Napolitana con Papas', 'Milanesa de peceto gratinada con salsa fileto casera, jamón, mozzarella y papas fritas.', 52000, NULL, true, true),
  ('55555555-5555-4555-8555-555555555504'::uuid, '44444444-4444-4444-8444-444444444401'::uuid,
   'Mbejú Relleno Cuatro Quesos', 'Mbejú crocante de almidón artesanal relleno con queso Paraguay, mozzarella, provolone y azul.', 28000, NULL, true, true),
  ('55555555-5555-4555-8555-555555555505'::uuid, '44444444-4444-4444-8444-444444444401'::uuid,
   'Chipa Guazú Tradicional', 'Porción recién horneada de choclo fresco, queso Paraguay estacionado y cebolla caramelizada.', 24000, NULL, true, true),
  ('55555555-5555-4555-8555-555555555506'::uuid, '44444444-4444-4444-8444-444444444401'::uuid,
   'Surubí al Roquefort', 'Posta grillada de surubí de río en reducción cremosa de queso azul con arroz kesú (Agotado).', 78000, NULL, false, true),

  -- Bebidas (4)
  ('55555555-5555-4555-8555-555555555507'::uuid, '44444444-4444-4444-8444-444444444402'::uuid,
   'Jugo Natural de Mburucuyá 500ml', 'Exprimido al momento de fruta fresca con hielo.', 16000, NULL, true, true),
  ('55555555-5555-4555-8555-555555555508'::uuid, '44444444-4444-4444-8444-444444444402'::uuid,
   'Limonada con Menta y Jengibre', 'Jarra individual refrescante con limones tahití, menta fresca y toque de jengibre.', 18000, NULL, true, true),
  ('55555555-5555-4555-8555-555555555509'::uuid, '44444444-4444-4444-8444-444444444402'::uuid,
   'Gaseosa Línea Coca-Cola 500ml', 'Original o Sin Azúcar bien fría.', 12000, NULL, true, true),
  ('55555555-5555-4555-8555-555555555510'::uuid, '44444444-4444-4444-8444-444444444402'::uuid,
   'Cerveza Artesanal Pilsen Pinta', 'Pinta tirada 473ml rubia suave y refrescante.', 25000, NULL, true, true),

  -- Postres (3)
  ('55555555-5555-4555-8555-555555555511'::uuid, '44444444-4444-4444-8444-444444444403'::uuid,
   'Flan Casero con Dulce de Leche', 'Flan de huevos de granja con caramelo y abundante dulce de leche.', 20000, NULL, true, true),
  ('55555555-5555-4555-8555-555555555512'::uuid, '44444444-4444-4444-8444-444444444403'::uuid,
   'Dulce de Mamón con Queso Paraguay', 'Postre típico en almíbar de clavo de olor acompañado de queso fresco.', 22000, NULL, true, true),
  ('55555555-5555-4555-8555-555555555513'::uuid, '44444444-4444-4444-8444-444444444403'::uuid,
   'Brownie Tibio con Helado', 'Brownie húmedo de cacao 70% con bocha de crema americana y salsa de chocolate.', 28000, NULL, true, true),

  -- Adicionales (3)
  ('55555555-5555-4555-8555-555555555514'::uuid, '44444444-4444-4444-8444-444444444404'::uuid,
   'Porción de Mandioca Frita', 'Bastones dorados de mandioca tierna con alioli suave.', 14000, NULL, true, true),
  ('55555555-5555-4555-8555-555555555515'::uuid, '44444444-4444-4444-8444-444444444404'::uuid,
   'Papas Fritas Rústicas', 'Papas cortadas a mano con piel y toque de romero.', 18000, NULL, true, true),
  ('55555555-5555-4555-8555-555555555516'::uuid, '44444444-4444-4444-8444-444444444404'::uuid,
   'Adicional Huevo a la Plancha', 'Huevo campero a la plancha para sumar al plato.', 8000, NULL, true, true)
ON CONFLICT (id) DO UPDATE SET
  category_id = EXCLUDED.category_id,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_amount = EXCLUDED.price_amount,
  image_url = EXCLUDED.image_url,
  is_available = EXCLUDED.is_available,
  is_active = EXCLUDED.is_active;

-- 7. Métodos de pago (4 métodos)
INSERT INTO public.payment_methods (id, code, name, requires_reference, is_cash, is_active, sort_order)
VALUES
  ('66666666-6666-4666-8666-666666666601'::uuid, 'efectivo',         'Efectivo (Gs.)',           false, true,  true, 1),
  ('66666666-6666-4666-8666-666666666602'::uuid, 'tarjeta_debito',   'Tarjeta de Débito',        false, false, true, 2),
  ('66666666-6666-4666-8666-666666666603'::uuid, 'tarjeta_credito',  'Tarjeta de Crédito',       false, false, true, 3),
  ('66666666-6666-4666-8666-666666666604'::uuid, 'transferencia_qr', 'Transferencia / QR SIPAP', true,  false, true, 4)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  requires_reference = EXCLUDED.requires_reference,
  is_cash = EXCLUDED.is_cash,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order;

COMMIT;
