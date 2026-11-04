"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { TEST_IDS } from "@/contracts/test-ids";
import { signInAction } from "@/server/auth/auth-actions";

const DEMO_USERS = [
  { role: "admin", label: "Admin", email: "admin@pedidosflash.local" },
  { role: "mozo", label: "Mozo", email: "mozo@pedidosflash.local" },
  { role: "cocina", label: "Cocina", email: "cocina@pedidosflash.local" },
  { role: "caja", label: "Caja", email: "caja@pedidosflash.local" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await signInAction({ email, password });
      if (!result.ok || !result.data) {
        setError(result.error ?? "No se pudo iniciar sesión.");
        return;
      }

      router.push(result.data.redirectTo);
      router.refresh();
    });
  };

  const handleFillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword("Flash123!");
    setError(null);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gradient-to-b from-orange-50/40 via-white to-gray-50 dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandLogo size="lg" showSlogan variant="full" />
        </div>

        <Card className="border border-orange-200/60 shadow-lg dark:border-slate-800">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold">Iniciar Sesión</CardTitle>
            <CardDescription>
              Ingresá con tu cuenta asignada para acceder al sistema.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div
                data-testid={TEST_IDS.AUTH.ERROR_ALERT}
                className="p-3 text-sm rounded-lg bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Correo Electrónico
                </label>
                <input
                  type="email"
                  required
                  data-testid={TEST_IDS.AUTH.EMAIL_INPUT}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ejemplo@pedidosflash.local"
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--pf-orange)] border-gray-300 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Contraseña
                </label>
                <input
                  type="password"
                  required
                  data-testid={TEST_IDS.AUTH.PASSWORD_INPUT}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--pf-orange)] border-gray-300 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <Button
                type="submit"
                disabled={isPending}
                data-testid={TEST_IDS.AUTH.SUBMIT_BTN}
                className="w-full bg-[var(--pf-orange)] hover:bg-[var(--pf-orange-hover)] text-white"
              >
                {isPending ? "Ingresando..." : "Ingresar"}
              </Button>
            </form>

            <div className="pt-4 border-t border-gray-100 dark:border-slate-800">
              <p className="text-xs text-center text-muted-foreground mb-2">
                Accesos rápidos de prueba (Seed QA):
              </p>
              <div className="grid grid-cols-4 gap-2">
                {DEMO_USERS.map((user) => (
                  <button
                    key={user.role}
                    type="button"
                    onClick={() => handleFillDemo(user.email)}
                    className="text-xs px-2 py-1.5 rounded-md border border-gray-200 hover:border-[var(--pf-orange)] hover:bg-orange-50/50 transition-colors dark:border-slate-700 dark:hover:bg-slate-800 font-medium"
                  >
                    {user.label}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
