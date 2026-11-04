import { z } from "zod";
import { COMANDA_STATUSES, COMANDA_TYPES, USER_ROLES } from "./domain";
import { CURRENCY_CODES } from "./money";

export const loginSchema = z.object({
  email: z.string().trim().email("Ingresá un correo válido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

export const openTableSessionSchema = z.object({
  tableId: z.string().uuid("Mesa inválida"),
  idempotencyKey: z.string().uuid("Clave de idempotencia inválida"),
});

export const comandaItemDraftSchema = z.object({
  productId: z.string().uuid("Producto inválido"),
  quantity: z
    .number()
    .int("La cantidad debe ser entera")
    .min(1, "Cantidad mínima 1")
    .max(99, "Cantidad máxima 99 por línea"),
  specialInstructions: z
    .string()
    .trim()
    .max(240, "Máximo 240 caracteres en observaciones")
    .optional()
    .nullable(),
});

export const createComandaSchema = z.object({
  tableSessionId: z.string().uuid("Sesión de mesa inválida"),
  idempotencyKey: z.string().uuid("Clave de idempotencia inválida"),
  comandaType: z.enum(COMANDA_TYPES).default("original"),
  parentComandaId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(300, "Máximo 300 caracteres").optional().nullable(),
  items: z.array(comandaItemDraftSchema).min(1, "Agregá al menos un producto a la comanda"),
});

export const advanceComandaStatusSchema = z.object({
  comandaId: z.string().uuid("Comanda inválida"),
  targetStatus: z.enum(COMANDA_STATUSES),
});

export const requestTableBillSchema = z.object({
  tableSessionId: z.string().uuid("Sesión de mesa inválida"),
  forceWithPendingKitchen: z.boolean().optional().default(false),
});

export const registerPaymentSchema = z.object({
  tableSessionId: z.string().uuid("Sesión de mesa inválida"),
  paymentMethodId: z.string().uuid("Método de pago inválido"),
  amount: z.number().int().positive("El monto debe ser mayor a cero"),
  amountTendered: z.number().int().nonnegative().optional().nullable(),
  referenceCode: z.string().trim().max(120).optional().nullable(),
  idempotencyKey: z.string().uuid("Clave de idempotencia inválida"),
});

export const upsertProductSchema = z.object({
  id: z.string().uuid().optional(),
  categoryId: z.string().uuid("Seleccioná una categoría"),
  name: z.string().trim().min(2, "Nombre requerido").max(120),
  description: z.string().trim().max(400).optional().nullable(),
  priceAmount: z.number().int().nonnegative("El precio no puede ser negativo"),
  imageUrl: z.string().trim().url("URL de imagen inválida").optional().or(z.literal("")).nullable(),
  isAvailable: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export const upsertCategorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Nombre requerido").max(80),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const upsertSectorSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Nombre requerido").max(80),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const upsertDiningTableSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, "Código de mesa requerido").max(20),
  name: z.string().trim().min(1, "Nombre de mesa requerido").max(60),
  sectorId: z.string().uuid("Seleccioná un sector"),
  capacity: z.number().int().min(1).max(30).default(4),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const createStaffUserSchema = z.object({
  email: z.string().trim().email("Correo inválido"),
  password: z.string().min(6, "Mínimo 6 caracteres"),
  fullName: z.string().trim().min(2, "Nombre completo requerido").max(120),
  role: z.enum(USER_ROLES),
});

export const updateStaffUserSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(USER_ROLES),
  isActive: z.boolean(),
});

export const updateRestaurantSettingsSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  slogan: z.string().trim().min(2).max(160),
  currencyCode: z.enum(CURRENCY_CODES),
  taxPercentage: z.number().min(0).max(50),
  kdsWarnMinutes: z.number().int().min(1).max(120),
  kdsCriticalMinutes: z.number().int().min(2).max(180),
  soundAlertsDefault: z.boolean(),
});
