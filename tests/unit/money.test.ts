import { describe, expect, it } from "vitest";
import {
  CURRENCY_CODES,
  CURRENCY_CONFIG,
  calculateCashChange,
  calculateItemsSubtotal,
  formatMoney,
} from "@/contracts/money";

describe("contracts/money — configuración monetaria", () => {
  it("define PYG sin decimales y monedas secundarias (USD, BRL, ARS) con 2 decimales", () => {
    expect(CURRENCY_CODES).toEqual(["PYG", "USD", "BRL", "ARS"]);
    expect(CURRENCY_CONFIG.PYG).toEqual({
      code: "PYG",
      symbol: "Gs.",
      name: "Guaraní paraguayo",
      decimals: 0,
    });
    expect(CURRENCY_CONFIG.USD.decimals).toBe(2);
    expect(CURRENCY_CONFIG.BRL.decimals).toBe(2);
    expect(CURRENCY_CONFIG.ARS.decimals).toBe(2);
  });
});

describe("contracts/money — formatMoney", () => {
  it("formatea montos en PYG como enteros sin decimales y con separador de miles '.'", () => {
    expect(formatMoney(0)).toBe("Gs. 0");
    expect(formatMoney(0, "PYG")).toBe("Gs. 0");
    expect(formatMoney(500, "PYG")).toBe("Gs. 500");
    expect(formatMoney(12000, "PYG")).toBe("Gs. 12.000");
    expect(formatMoney(45000)).toBe("Gs. 45.000");
    expect(formatMoney(125000, "PYG")).toBe("Gs. 125.000");
    expect(formatMoney(1500000, "PYG")).toBe("Gs. 1.500.000");
  });

  it("maneja montos negativos, redondeo defensivo y valores no finitos en PYG", () => {
    expect(formatMoney(-35000, "PYG")).toBe("-Gs. 35.000");
    expect(formatMoney(12500.4, "PYG")).toBe("Gs. 12.500");
    expect(formatMoney(12500.6, "PYG")).toBe("Gs. 12.501");
    expect(formatMoney(Number.NaN, "PYG")).toBe("Gs. 0");
    expect(formatMoney(Number.POSITIVE_INFINITY, "PYG")).toBe("Gs. 0");
    expect(formatMoney(Number.NEGATIVE_INFINITY, "PYG")).toBe("Gs. 0");
  });

  it("formatea monedas secundarias (USD, BRL, ARS) desde unidades menores con coma decimal", () => {
    expect(formatMoney(0, "USD")).toBe("US$ 0,00");
    expect(formatMoney(5, "USD")).toBe("US$ 0,05");
    expect(formatMoney(1250, "USD")).toBe("US$ 12,50");
    expect(formatMoney(123456, "USD")).toBe("US$ 1.234,56");
    expect(formatMoney(-999, "USD")).toBe("-US$ 9,99");

    expect(formatMoney(4590, "BRL")).toBe("R$ 45,90");
    expect(formatMoney(100000, "BRL")).toBe("R$ 1.000,00");

    expect(formatMoney(75, "ARS")).toBe("$ 0,75");
    expect(formatMoney(850000, "ARS")).toBe("$ 8.500,00");
  });
});

describe("contracts/money — calculateItemsSubtotal", () => {
  it("retorna 0 para una lista vacía de ítems", () => {
    expect(calculateItemsSubtotal([])).toBe(0);
  });

  it("calcula con exactitud el subtotal entero de múltiples productos gastronómicos en PYG", () => {
    const subtotal = calculateItemsSubtotal([
      { unitPrice: 12000, quantity: 2 }, // 24.000
      { unitPrice: 45000, quantity: 2 }, // 90.000
      { unitPrice: 18000, quantity: 2 }, // 36.000
    ]);

    expect(subtotal).toBe(150000);
    expect(formatMoney(subtotal, "PYG")).toBe("Gs. 150.000");
  });

  it("acota cantidades negativas o cero a 0 y redondea valores fraccionarios defensivamente", () => {
    const subtotal = calculateItemsSubtotal([
      { unitPrice: 48000, quantity: 2 },
      { unitPrice: 25000, quantity: 0 },
      { unitPrice: 65000, quantity: -3 },
      { unitPrice: 10000.2, quantity: 1.4 },
    ]);

    expect(subtotal).toBe(106000);
  });
});

describe("contracts/money — calculateCashChange", () => {
  it("retorna 0 cuando el pago en efectivo es exacto o parcial (menor al saldo)", () => {
    expect(calculateCashChange(208000, 208000)).toBe(0);
    expect(calculateCashChange(208000, 100000)).toBe(0);
    expect(calculateCashChange(50000, 0)).toBe(0);
  });

  it("calcula el vuelto exacto en PYG cuando el monto recibido supera el saldo", () => {
    expect(calculateCashChange(108000, 150000)).toBe(42000);
    expect(calculateCashChange(125000, 200000)).toBe(75000);
  });

  it("protege contra entradas negativas sin devolver vueltos negativos", () => {
    expect(calculateCashChange(-10000, 50000)).toBe(50000);
    expect(calculateCashChange(50000, -10000)).toBe(0);
  });
});
