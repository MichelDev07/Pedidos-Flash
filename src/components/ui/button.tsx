"use client";

import React, { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "success"
  | "outline"
  | "ghost"
  | "danger";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Muestra spinner y bloquea pulsaciones adicionales */
  isLoading?: boolean;
  /** Texto alternativo opcional mientras isLoading está activo */
  loadingText?: string;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    "bg-[#FF6B35] text-white hover:bg-[#E85A24] active:bg-[#D14B18] shadow-xs focus-visible:ring-[#FF6B35]",
  secondary:
    "bg-[#172033] text-white hover:bg-[#212E48] active:bg-[#0B111E] dark:bg-[#24324F] dark:hover:bg-[#2E3F63] shadow-xs focus-visible:ring-[#172033]",
  success:
    "bg-[#22C55E] text-[#052E16] hover:bg-[#16A34A] hover:text-white active:bg-[#15803D] shadow-xs focus-visible:ring-[#22C55E]",
  outline:
    "border-2 border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-muted)] focus-visible:ring-[#FF6B35]",
  ghost:
    "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] focus-visible:ring-[#FF6B35]",
  danger:
    "bg-[#EF4444] text-white hover:bg-[#DC2626] active:bg-[#B91C1C] shadow-xs focus-visible:ring-[#EF4444]",
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: "min-h-10 h-10 px-3.5 text-sm rounded-xl gap-1.5",
  md: "min-h-12 h-12 px-4 text-base rounded-xl gap-2",
  lg: "min-h-14 h-14 px-6 text-lg rounded-2xl gap-2.5",
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function Button({
  variant = "primary",
  size = "md",
  isLoading = false,
  loadingText,
  fullWidth = false,
  leftIcon,
  rightIcon,
  disabled,
  className,
  onClick,
  type = "button",
  children,
  ref,
  ...rest
}: ButtonProps) {
  const [asyncPending, setAsyncPending] = useState(false);
  const inFlightRef = useRef(false);

  const busy = isLoading || asyncPending;
  const isDisabled = Boolean(disabled) || busy;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isDisabled || inFlightRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!onClick) return;

    const result: unknown = onClick(event);
    if (isPromiseLike(result)) {
      inFlightRef.current = true;
      setAsyncPending(true);
      Promise.resolve(result)
        .catch(() => {
          // Los errores de negocio son gestionados por el handler llamador
        })
        .finally(() => {
          inFlightRef.current = false;
          setAsyncPending(false);
        });
    }
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={busy || undefined}
      onClick={handleClick}
      className={cn(
        "inline-flex items-center justify-center font-bold select-none transition-all duration-100",
        "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60 disabled:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-canvas)]",
        "cursor-pointer",
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        fullWidth && "w-full",
        className
      )}
      {...rest}
    >
      {busy ? (
        <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>
      )}
      <span className="truncate">{busy && loadingText ? loadingText : children}</span>
      {!busy && rightIcon && <span className="inline-flex shrink-0">{rightIcon}</span>}
    </button>
  );
}
