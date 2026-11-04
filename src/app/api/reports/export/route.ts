import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { formatMoney } from "@/contracts/money";
import { AuthError, requireRole } from "@/server/auth/session";
import { getSalesReportData, type SalesReportData } from "@/server/queries/admin";

const exportQuerySchema = z.object({
  from: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inicial inválido (YYYY-MM-DD)")
    .optional(),
  to: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha final inválido (YYYY-MM-DD)")
    .optional(),
  delimiter: z.enum(["semicolon", "comma"]).optional().default("semicolon"),
});

function sanitizeCsvText(raw: string): string {
  // Mitigar inyección de fórmulas en Excel (=, +, -, @ al inicio de cadenas de texto)
  if (/^[=+\-@]/.test(raw)) {
    return `'${raw}`;
  }
  return raw;
}

function formatCsvCell(value: string | number, sep: string): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "0";
  }

  const safeText = sanitizeCsvText(value);
  if (
    safeText.includes(sep) ||
    safeText.includes('"') ||
    safeText.includes("\n") ||
    safeText.includes("\r")
  ) {
    return `"${safeText.replace(/"/g, '""')}"`;
  }
  return safeText;
}

function toCsvLine(cells: ReadonlyArray<string | number>, sep: string): string {
  return cells.map((cell) => formatCsvCell(cell, sep)).join(sep);
}

function buildSalesReportCsv(
  report: SalesReportData,
  generatedByEmail: string,
  sep: ";" | ","
): string {
  const currency = report.summary.currencyCode;
  const lines: string[] = [];

  // Encabezado institucional
  lines.push(toCsvLine(["REPORTE DE VENTAS — PEDIDOS FLASH"], sep));
  lines.push(toCsvLine(["Restaurante", report.businessName], sep));
  lines.push(
    toCsvLine(
      ["Período", `${report.range.fromDate} a ${report.range.toDate}`],
      sep
    )
  );
  lines.push(toCsvLine(["Moneda", currency], sep));
  lines.push(toCsvLine(["Generado por", generatedByEmail], sep));
  lines.push(toCsvLine(["Fecha de exportación", new Date().toISOString()], sep));
  lines.push("");

  // Sección 1: Resumen ejecutivo
  lines.push(toCsvLine(["RESUMEN DEL PERÍODO"], sep));
  lines.push(toCsvLine(["Indicador", "Valor Numérico", "Valor Formateado"], sep));
  lines.push(
    toCsvLine(
      [
        "Ventas totales confirmadas",
        report.summary.totalRevenue,
        formatMoney(report.summary.totalRevenue, currency),
      ],
      sep
    )
  );
  lines.push(
    toCsvLine(
      [
        "Ticket promedio por mesa",
        report.summary.averageTicket,
        formatMoney(report.summary.averageTicket, currency),
      ],
      sep
    )
  );
  lines.push(
    toCsvLine(
      [
        "Mesas atendidas (sesiones cerradas)",
        report.summary.tablesServedCount,
        String(report.summary.tablesServedCount),
      ],
      sep
    )
  );
  lines.push(
    toCsvLine(
      [
        "Pedidos / Comandas registradas",
        report.summary.ordersCount,
        String(report.summary.ordersCount),
      ],
      sep
    )
  );
  lines.push(
    toCsvLine(
      [
        "Unidades de productos vendidas",
        report.summary.itemsSoldCount,
        String(report.summary.itemsSoldCount),
      ],
      sep
    )
  );
  lines.push(
    toCsvLine(
      [
        "Pagos procesados",
        report.summary.totalPaymentsCount,
        String(report.summary.totalPaymentsCount),
      ],
      sep
    )
  );
  lines.push("");

  // Sección 2: Ventas por día
  lines.push(toCsvLine(["VENTAS POR DÍA"], sep));
  lines.push(
    toCsvLine(
      [
        "Fecha",
        "Mesas Atendidas",
        "Comandas",
        "Pagos",
        `Total Ventas (${currency})`,
        "Total Formateado",
      ],
      sep
    )
  );
  if (report.salesByDay.length === 0) {
    lines.push(toCsvLine(["Sin registros en el período", 0, 0, 0, 0, formatMoney(0, currency)], sep));
  } else {
    for (const row of report.salesByDay) {
      lines.push(
        toCsvLine(
          [
            row.date,
            row.tablesServed,
            row.ordersCount,
            row.paymentsCount,
            row.totalSales,
            formatMoney(row.totalSales, currency),
          ],
          sep
        )
      );
    }
  }
  lines.push("");

  // Sección 3: Productos más vendidos
  lines.push(toCsvLine(["PRODUCTOS MÁS VENDIDOS"], sep));
  lines.push(
    toCsvLine(
      [
        "Producto",
        "Unidades Vendidas",
        "Comandas con el Producto",
        `Ingresos (${currency})`,
        "Ingresos Formateados",
      ],
      sep
    )
  );
  if (report.topProducts.length === 0) {
    lines.push(toCsvLine(["Sin ventas de productos", 0, 0, 0, formatMoney(0, currency)], sep));
  } else {
    for (const prod of report.topProducts) {
      lines.push(
        toCsvLine(
          [
            prod.productName,
            prod.quantitySold,
            prod.ordersCount,
            prod.totalRevenue,
            formatMoney(prod.totalRevenue, currency),
          ],
          sep
        )
      );
    }
  }
  lines.push("");

  // Sección 4: Ventas por mozo
  lines.push(toCsvLine(["DESEMPEÑO POR MOZO"], sep));
  lines.push(
    toCsvLine(
      [
        "Mozo",
        "Mesas Atendidas",
        "Comandas Enviadas",
        `Ventas (${currency})`,
        "Ventas Formateadas",
      ],
      sep
    )
  );
  if (report.salesByWaiter.length === 0) {
    lines.push(toCsvLine(["Sin actividad registrada", 0, 0, 0, formatMoney(0, currency)], sep));
  } else {
    for (const waiter of report.salesByWaiter) {
      lines.push(
        toCsvLine(
          [
            waiter.waiterName,
            waiter.tablesServed,
            waiter.ordersCount,
            waiter.totalSales,
            formatMoney(waiter.totalSales, currency),
          ],
          sep
        )
      );
    }
  }
  lines.push("");

  // Sección 5: Desglose por método de pago
  lines.push(toCsvLine(["DESGLOSE POR MÉTODO DE PAGO"], sep));
  lines.push(
    toCsvLine(
      [
        "Método de Pago",
        "Código",
        "Transacciones",
        `Monto Total (${currency})`,
        "Participación (%)",
        "Monto Formateado",
      ],
      sep
    )
  );
  if (report.salesByPaymentMethod.length === 0) {
    lines.push(
      toCsvLine(["Sin cobros registrados", "-", 0, 0, "0%", formatMoney(0, currency)], sep)
    );
  } else {
    for (const pm of report.salesByPaymentMethod) {
      lines.push(
        toCsvLine(
          [
            pm.paymentMethodName,
            pm.paymentMethodCode,
            pm.transactionsCount,
            pm.totalAmount,
            `${pm.percentage}%`,
            formatMoney(pm.totalAmount, currency),
          ],
          sep
        )
      );
    }
  }

  // UTF-8 BOM (\uFEFF) + saltos CRLF estándar para compatibilidad directa con Microsoft Excel
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export async function GET(request: NextRequest) {
  try {
    const adminProfile = await requireRole(["admin"]);

    const searchParams = request.nextUrl.searchParams;
    const rawFrom =
      searchParams.get("from") ?? searchParams.get("fromDate") ?? undefined;
    const rawTo =
      searchParams.get("to") ?? searchParams.get("toDate") ?? undefined;
    const rawDelimiter = searchParams.get("delimiter") ?? undefined;

    const parsed = exportQuerySchema.safeParse({
      from: rawFrom || undefined,
      to: rawTo || undefined,
      delimiter: rawDelimiter || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error:
            parsed.error.issues[0]?.message ??
            "Parámetros de rango de fechas inválidos.",
          code: "VALIDATION_ERROR",
        },
        { status: 400 }
      );
    }

    const report = await getSalesReportData(parsed.data.from, parsed.data.to);
    const separator = parsed.data.delimiter === "comma" ? "," : ";";
    const csvContent = buildSalesReportCsv(
      report,
      adminProfile.email || adminProfile.full_name,
      separator
    );

    const filename = `pedidos-flash-reporte-${report.range.fromDate}-a-${report.range.toDate}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "Error al generar la exportación del reporte de ventas.",
        code: "EXPORT_ERROR",
      },
      { status: 500 }
    );
  }
}
