import { describe, expect, it } from "vitest";
import {
  advanceComandaStatusSchema,
  createComandaSchema,
  loginSchema,
  openTableSessionSchema,
  registerPaymentSchema,
  requestTableBillSchema,
  upsertProductSchema,
} from "@/contracts/schemas";

const VALID_UUID_1 = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222222";
const VALID_UUID_3 = "33333333-3333-4333-8333-333333333333";

describe("contracts/schemas — openTableSessionSchema", () => {
  it("acepta tableId e idempotencyKey con formato UUID válido", () => {
    const parsed = openTableSessionSchema.safeParse({
      tableId: VALID_UUID_1,
      idempotencyKey: VALID_UUID_2,
    });

    expect(parsed.success).toBe(true);
  });

  it("rechaza identificadores que no sean UUID válidos", () => {
    expect(
      openTableSessionSchema.safeParse({
        tableId: "mesa-1",
        idempotencyKey: VALID_UUID_2,
      }).success
    ).toBe(false);

    expect(
      openTableSessionSchema.safeParse({
        tableId: VALID_UUID_1,
        idempotencyKey: "not-a-uuid",
      }).success
    ).toBe(false);
  });
});

describe("contracts/schemas — createComandaSchema", () => {
  it("valida una comanda correcta, recorta espacios y asigna comandaType='original' por defecto", () => {
    const parsed = createComandaSchema.safeParse({
      tableSessionId: VALID_UUID_1,
      idempotencyKey: VALID_UUID_2,
      notes: "  Servir entradas primero  ",
      items: [
        {
          productId: VALID_UUID_3,
          quantity: 2,
          specialInstructions: "  1 sin cebolla  ",
        },
      ],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.comandaType).toBe("original");
      expect(parsed.data.notes).toBe("Servir entradas primero");
      expect(parsed.data.items[0]?.specialInstructions).toBe("1 sin cebolla");
    }
  });

  it("rechaza comandas vacías sin productos", () => {
    const parsed = createComandaSchema.safeParse({
      tableSessionId: VALID_UUID_1,
      idempotencyKey: VALID_UUID_2,
      items: [],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain("al menos un producto");
    }
  });

  it("valida límites enteros estrictos de cantidad por línea (1..99) y rechaza decimales", () => {
    const buildPayload = (quantity: number) => ({
      tableSessionId: VALID_UUID_1,
      idempotencyKey: VALID_UUID_2,
      items: [{ productId: VALID_UUID_3, quantity }],
    });

    expect(createComandaSchema.safeParse(buildPayload(1)).success).toBe(true);
    expect(createComandaSchema.safeParse(buildPayload(99)).success).toBe(true);

    expect(createComandaSchema.safeParse(buildPayload(0)).success).toBe(false);
    expect(createComandaSchema.safeParse(buildPayload(-2)).success).toBe(false);
    expect(createComandaSchema.safeParse(buildPayload(100)).success).toBe(false);
    expect(createComandaSchema.safeParse(buildPayload(1.5)).success).toBe(false);
  });

  it("rechaza UUIDs inválidos de idempotencia o sesión y textos que exceden longitudes máximas", () => {
    expect(
      createComandaSchema.safeParse({
        tableSessionId: VALID_UUID_1,
        idempotencyKey: "clave-invalida",
        items: [{ productId: VALID_UUID_3, quantity: 1 }],
      }).success
    ).toBe(false);

    expect(
      createComandaSchema.safeParse({
        tableSessionId: VALID_UUID_1,
        idempotencyKey: VALID_UUID_2,
        notes: "x".repeat(301),
        items: [{ productId: VALID_UUID_3, quantity: 1 }],
      }).success
    ).toBe(false);

    expect(
      createComandaSchema.safeParse({
        tableSessionId: VALID_UUID_1,
        idempotencyKey: VALID_UUID_2,
        items: [
          {
            productId: VALID_UUID_3,
            quantity: 1,
            specialInstructions: "y".repeat(241),
          },
        ],
      }).success
    ).toBe(false);
  });
});

describe("contracts/schemas — registerPaymentSchema", () => {
  it("acepta pagos enteros positivos en PYG con clave de idempotencia UUID y monto recibido opcional", () => {
    const parsed = registerPaymentSchema.safeParse({
      tableSessionId: VALID_UUID_1,
      paymentMethodId: VALID_UUID_2,
      amount: 108000,
      amountTendered: 150000,
      referenceCode: "  QR-998877  ",
      idempotencyKey: VALID_UUID_3,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.referenceCode).toBe("QR-998877");
    }
  });

  it("rechaza montos cero, negativos, decimales o claves de idempotencia inválidas", () => {
    const base = {
      tableSessionId: VALID_UUID_1,
      paymentMethodId: VALID_UUID_2,
      idempotencyKey: VALID_UUID_3,
    };

    expect(registerPaymentSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(registerPaymentSchema.safeParse({ ...base, amount: -45000 }).success).toBe(false);
    expect(registerPaymentSchema.safeParse({ ...base, amount: 45000.5 }).success).toBe(false);
    expect(
      registerPaymentSchema.safeParse({
        ...base,
        amount: 45000,
        amountTendered: -1,
      }).success
    ).toBe(false);
    expect(
      registerPaymentSchema.safeParse({
        ...base,
        amount: 45000,
        idempotencyKey: "dup-key-123",
      }).success
    ).toBe(false);
  });
});

describe("contracts/schemas — esquemas operativos complementarios", () => {
  it("valida advanceComandaStatusSchema, requestTableBillSchema, upsertProductSchema y loginSchema", () => {
    expect(
      advanceComandaStatusSchema.safeParse({
        comandaId: VALID_UUID_1,
        targetStatus: "listo",
      }).success
    ).toBe(true);

    expect(
      advanceComandaStatusSchema.safeParse({
        comandaId: VALID_UUID_1,
        targetStatus: "cancelado_inexistente",
      }).success
    ).toBe(false);

    const billReq = requestTableBillSchema.safeParse({ tableSessionId: VALID_UUID_1 });
    expect(billReq.success).toBe(true);
    if (billReq.success) {
      expect(billReq.data.forceWithPendingKitchen).toBe(false);
    }

    expect(
      upsertProductSchema.safeParse({
        categoryId: VALID_UUID_1,
        name: "Lomito Árabe Completo",
        priceAmount: 45000,
        imageUrl: "",
      }).success
    ).toBe(true);

    expect(
      upsertProductSchema.safeParse({
        categoryId: VALID_UUID_1,
        name: "Producto Inválido",
        priceAmount: -1000,
      }).success
    ).toBe(false);

    const login = loginSchema.safeParse({
      email: "  mozo@pedidosflash.local ",
      password: "Flash123!",
    });
    expect(login.success).toBe(true);
    if (login.success) {
      expect(login.data.email).toBe("mozo@pedidosflash.local");
    }
  });
});
