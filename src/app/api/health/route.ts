import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { ok: true, service: "pedidos-flash" },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
