export const CURRENCY_CODES = ["PYG", "USD", "BRL", "ARS"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface CurrencyMetadata {
  code: CurrencyCode;
  symbol: string;
  name: string;
  decimals: 0 | 2;
}

export const CURRENCY_CONFIG: Record<CurrencyCode, CurrencyMetadata> = {
  PYG: {
    code: "PYG",
    symbol: "Gs.",
    name: "Guaraní paraguayo",
    decimals: 0,
  },
  USD: {
    code: "USD",
    symbol: "US$",
    name: "Dólar estadounidense",
    decimals: 2,
  },
  BRL: {
    code: "BRL",
    symbol: "R$",
    name: "Real brasileño",
    decimals: 2,
  },
  ARS: {
    code: "ARS",
    symbol: "$",
    name: "Peso argentino",
    decimals: 2,
  },
};

/**
 * Formatea un monto entero (en unidades menores; para PYG son guaraníes exactos sin decimales)
 * de manera determinística sin depender de variaciones de locale del sistema operativo.
 * Ejemplo: formatMoney(125000, "PYG") -> "Gs. 125.000"
 */
export function formatMoney(amount: number, currencyCode: CurrencyCode = "PYG"): string {
  const safeAmount = Math.round(Number.isFinite(amount) ? amount : 0);
  const meta = CURRENCY_CONFIG[currencyCode] ?? CURRENCY_CONFIG.PYG;
  const isNegative = safeAmount < 0;
  const abs = Math.abs(safeAmount);

  if (meta.decimals === 0) {
    const formattedInt = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${isNegative ? "-" : ""}${meta.symbol} ${formattedInt}`;
  }

  const divisor = 10 ** meta.decimals;
  const integerPart = Math.floor(abs / divisor)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimalPart = (abs % divisor).toString().padStart(meta.decimals, "0");
  return `${isNegative ? "-" : ""}${meta.symbol} ${integerPart},${decimalPart}`;
}

export function calculateItemsSubtotal(
  items: ReadonlyArray<{ unitPrice: number; quantity: number }>
): number {
  return items.reduce((acc, item) => {
    const price = Math.round(item.unitPrice);
    const qty = Math.max(0, Math.round(item.quantity));
    return acc + price * qty;
  }, 0);
}

export function calculateCashChange(amountDue: number, amountTendered: number): number {
  const due = Math.max(0, Math.round(amountDue));
  const tendered = Math.max(0, Math.round(amountTendered));
  return Math.max(0, tendered - due);
}
