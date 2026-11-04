import Link from "next/link";
import { BrandLogo, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gradient-to-b from-orange-50/40 via-white to-gray-50 dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <BrandLogo size="xl" showSlogan variant="full" />
        </div>

        <Card className="border border-orange-200/60 shadow-lg dark:border-slate-800">
          <CardHeader>
            <CardTitle className="text-xl font-bold">Portal Operativo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              De la mesa a la cocina, en un flash. Accedé a tu módulo correspondiente:
            </p>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <Link
                href="/mozo"
                className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-200 hover:border-orange-500 hover:bg-orange-50/50 transition-all font-medium text-sm shadow-sm dark:border-slate-800 dark:hover:bg-slate-800"
              >
                <span className="text-2xl mb-1">📱</span>
                <span>Salón / Mozo</span>
              </Link>
              <Link
                href="/cocina"
                className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-200 hover:border-orange-500 hover:bg-orange-50/50 transition-all font-medium text-sm shadow-sm dark:border-slate-800 dark:hover:bg-slate-800"
              >
                <span className="text-2xl mb-1">🍳</span>
                <span>Cocina (KDS)</span>
              </Link>
              <Link
                href="/caja"
                className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-200 hover:border-orange-500 hover:bg-orange-50/50 transition-all font-medium text-sm shadow-sm dark:border-slate-800 dark:hover:bg-slate-800"
              >
                <span className="text-2xl mb-1">💵</span>
                <span>Caja / Cobro</span>
              </Link>
              <Link
                href="/admin"
                className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-200 hover:border-orange-500 hover:bg-orange-50/50 transition-all font-medium text-sm shadow-sm dark:border-slate-800 dark:hover:bg-slate-800"
              >
                <span className="text-2xl mb-1">⚙️</span>
                <span>Administración</span>
              </Link>
            </div>

            <div className="pt-4 border-t border-gray-100 dark:border-slate-800">
              <Link
                href="/login"
                className="inline-flex w-full items-center justify-center rounded-lg bg-[var(--pf-orange)] px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-[var(--pf-orange-hover)] transition-colors"
              >
                Iniciar Sesión
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

