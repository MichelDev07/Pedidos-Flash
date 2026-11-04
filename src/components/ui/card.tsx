import React from "react";
import { cn } from "./cn";

export type CardVariant =
  | "default"
  | "elevated"
  | "interactive"
  | "muted"
  | "kds-nuevo"
  | "kds-ready"
  | "billing";

export type CardPadding = "none" | "sm" | "md" | "lg";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  ref?: React.Ref<HTMLDivElement>;
}

const CARD_VARIANTS: Record<CardVariant, string> = {
  default:
    "bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)] shadow-xs",
  elevated:
    "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)] shadow-md",
  interactive:
    "bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)] shadow-xs hover:border-[#FF6B35] active:scale-[0.99] transition-all duration-100 cursor-pointer",
  muted:
    "bg-[var(--bg-muted)] text-[var(--text-primary)] border border-transparent",
  "kds-nuevo":
    "bg-[var(--bg-surface)] text-[var(--text-primary)] border-[3px] border-[#FF6B35] shadow-md animate-kds-new",
  "kds-ready":
    "bg-[var(--bg-surface)] text-[var(--text-primary)] border-2 border-[#22C55E] shadow-sm",
  billing:
    "bg-[var(--table-cobro-bg)] text-[var(--text-primary)] border-2 border-[#F59E0B] shadow-xs",
};

const CARD_PADDING: Record<CardPadding, string> = {
  none: "p-0",
  sm: "p-3",
  md: "p-4",
  lg: "p-5 sm:p-6",
};

export function Card({
  variant = "default",
  padding = "md",
  className,
  children,
  ref,
  ...rest
}: CardProps) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl",
        CARD_VARIANTS[variant],
        CARD_PADDING[padding],
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-start justify-between gap-3 pb-3", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-lg font-extrabold tracking-tight text-[var(--text-primary)]",
        className
      )}
      {...rest}
    >
      {children}
    </h3>
  );
}

export function CardDescription({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm text-[var(--text-secondary)]", className)}
      {...rest}
    >
      {children}
    </p>
  );
}

export function CardContent({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-3", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-4 flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-3",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
