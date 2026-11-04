"use client";

import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "./cn";

export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "pf-theme";

export interface ThemeToggleProps {
  /** Si no existe preferencia previa en localStorage, usa este modo inicial */
  defaultTheme?: ThemeMode;
  showLabel?: boolean;
  className?: string;
}

function applyDocumentTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute("content", mode === "dark" ? "#0B111E" : "#172033");
  }
}

export function ThemeToggle({
  defaultTheme,
  showLabel = false,
  className,
}: ThemeToggleProps) {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let resolved: ThemeMode = "light";
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "dark" || stored === "light") {
        resolved = stored;
      } else if (defaultTheme) {
        resolved = defaultTheme;
      } else if (document.documentElement.classList.contains("dark")) {
        resolved = "dark";
      } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        resolved = "dark";
      }
    } catch {
      resolved = defaultTheme ?? "light";
    }

    setTheme(resolved);
    applyDocumentTheme(resolved);
    setMounted(true);
  }, [defaultTheme]);

  const toggleTheme = () => {
    const nextTheme: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyDocumentTheme(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Ignorar si almacenamiento está restringido en modo quiosco/privado
    }
  };

  const isDark = mounted && theme === "dark";
  const label = isDark ? "Modo claro" : "Modo oscuro";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Cambiar a ${label.toLowerCase()}`}
      title={`Cambiar a ${label.toLowerCase()}`}
      className={cn(
        "touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)]",
        "bg-[var(--bg-surface)] px-3 text-sm font-semibold text-[var(--text-primary)] shadow-2xs",
        "transition-colors hover:bg-[var(--bg-muted)] active:scale-[0.97]",
        "focus-visible:ring-2 focus-visible:ring-[#FF6B35] focus-visible:outline-none cursor-pointer",
        className
      )}
    >
      {isDark ? (
        <Sun className="size-5 shrink-0 text-[#F59E0B]" aria-hidden="true" />
      ) : (
        <Moon className="size-5 shrink-0 text-[#172033] dark:text-slate-200" aria-hidden="true" />
      )}
      {showLabel && <span>{label}</span>}
    </button>
  );
}
