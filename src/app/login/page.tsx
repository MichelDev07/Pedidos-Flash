"use client";

import React, { Suspense, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandLogo, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { TEST_IDS } from "@/contracts/test-ids";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { signInAction } from "@/server/auth/auth-actions";

const DEMO_USERS = [
  { role: "admin", label: "Admin", email: "admin@pedidosflash.local" },
  { role: "mozo", label: "Mozo", email: "mozo@pedidosflash.local" },
  { role: "cocina", label: "Cocina", email: "cocina@pedidosflash.local" },
  { role: "caja", label: "Caja", email: "caja@pedidosflash.local" },
];

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 170 170" width="18" height="18" fill="currentColor">
      <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.92-3.16-7.85-7.89-11.78-14.2-4.79-7.73-8.71-16.7-11.77-26.91-3.05-10.22-4.58-19.86-4.58-28.94 0-14.28 3.69-25.83 11.07-34.64 7.38-8.81 16.57-13.31 27.57-13.5 4.68 0 9.85 1.25 15.51 3.75 5.66 2.5 9.4 3.79 11.22 3.86 1.63 0 5.67-1.33 12.12-3.98 6.45-2.66 11.83-3.87 16.14-3.64 12.08.61 21.84 5.38 29.28 14.31-10.66 6.42-15.89 15.28-15.69 26.58.2 8.79 3.58 16.2 10.15 22.23 6.57 6.03 14.33 9.48 23.27 10.35-2.39 7.08-5.18 14.01-8.38 20.79zM119.22 31.84c0-7.39 2.7-14.27 8.1-20.64 5.4-6.37 12.08-10.45 20.03-12.24.22 1.52.33 2.93.33 4.23 0 7.39-2.8 14.37-8.4 20.93-5.6 6.56-12.44 10.45-20.52 11.67-.32-1.3-.49-2.61-.49-3.95z" />
    </svg>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const errParam = searchParams.get("error");
    if (errParam === "cuenta_inactiva") {
      setError("Tu cuenta se encuentra inactiva. Contactá al administrador.");
    } else if (errParam === "oauth_error") {
      setError("No se pudo completar la autenticación con el proveedor. Verificá que el proveedor esté configurado en Supabase.");
    }
  }, [searchParams]);

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

  const handleOAuthSignIn = async (provider: "google" | "apple") => {
    try {
      setOauthLoading(provider);
      setError(null);
      const supabase = createBrowserSupabaseClient();
      const redirectTo = `${window.location.origin}/auth/callback`;

      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
        },
      });

      if (oauthError) {
        setError(oauthError.message);
        setOauthLoading(null);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al iniciar sesión con OAuth";
      setError(message);
      setOauthLoading(null);
    }
  };

  const handleFillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword("Flash123!");
    setError(null);
  };

  return (
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

        {/* Botones OAuth: Google y Apple */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={oauthLoading !== null || isPending}
            onClick={() => handleOAuthSignIn("google")}
            data-testid={TEST_IDS.AUTH.GOOGLE_BTN}
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800 transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            <GoogleIcon />
            <span>{oauthLoading === "google" ? "Conectando..." : "Google"}</span>
          </button>

          <button
            type="button"
            disabled={oauthLoading !== null || isPending}
            onClick={() => handleOAuthSignIn("apple")}
            data-testid={TEST_IDS.AUTH.APPLE_BTN}
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-gray-900 bg-black text-white hover:bg-gray-900 dark:border-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            <AppleIcon />
            <span>{oauthLoading === "apple" ? "Conectando..." : "Apple"}</span>
          </button>
        </div>

        <div className="relative flex items-center justify-center py-2">
          <div className="border-t border-gray-200 dark:border-slate-800 w-full" />
          <span className="bg-white dark:bg-slate-900 px-3 text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">
            O con correo
          </span>
          <div className="border-t border-gray-200 dark:border-slate-800 w-full" />
        </div>

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
            disabled={isPending || oauthLoading !== null}
            data-testid={TEST_IDS.AUTH.SUBMIT_BTN}
            className="w-full bg-[var(--pf-orange)] hover:bg-[var(--pf-orange-hover)] text-white"
          >
            {isPending ? "Ingresando..." : "Ingresar con Correo"}
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
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gradient-to-b from-orange-50/40 via-white to-gray-50 dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandLogo size="lg" showSlogan variant="full" />
        </div>
        <Suspense fallback={<div className="text-center text-sm text-muted-foreground">Cargando...</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
