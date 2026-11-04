import React from "react";
import {
  COMANDA_STATUS_LABELS,
  ROLE_LABELS,
  TABLE_STATUS_LABELS,
  type ComandaStatus,
  type TableStatus,
  type UserRole,
} from "@/contracts/domain";
import { cn } from "./cn";

export type BadgeVariant =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "outline";

export type BadgeSize = "sm" | "md" | "lg";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Atajo semántico directo para estados de mesa */
  tableStatus?: TableStatus;
  /** Atajo semántico directo para estados de comanda en KDS / Salón */
  comandaStatus?: ComandaStatus;
  /** Atajo semántico directo para roles de usuario */
  userRole?: UserRole;
  /** Muestra indicador circular de estado */
  dot?: boolean;
  /** Activa pulso visual para estados urgentes o nuevos */
  pulse?: boolean;
}

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs gap-1",
  md: "px-2.5 py-1 text-xs gap-1.5",
  lg: "px-3 py-1.5 text-sm gap-2",
};

const GENERIC_VARIANTS: Record<BadgeVariant, string> = {
  neutral:
    "bg-[var(--bg-muted)] text-[var(--text-secondary)] border-[var(--border-subtle)]",
  brand:
    "bg-[var(--pf-orange-soft)] text-[#C2410C] dark:text-[#FF9E7A] border-[#FF6B35]",
  success:
    "bg-[var(--kds-listo-bg)] text-[var(--kds-listo-text)] border-[var(--kds-listo-border)]",
  warning:
    "bg-[var(--kds-preparando-bg)] text-[var(--kds-preparando-text)] border-[var(--kds-preparando-border)]",
  danger:
    "bg-[var(--sla-critical-bg)] text-[var(--sla-critical-text)] border-[var(--sla-critical-border)]",
  info: "bg-[var(--kds-recibido-bg)] text-[var(--kds-recibido-text)] border-[var(--kds-recibido-border)]",
  outline:
    "bg-transparent text-[var(--text-primary)] border-[var(--border-strong)]",
};

const TABLE_STATUS_STYLES: Record<TableStatus, { classes: string; dotColor: string }> = {
  libre: {
    classes:
      "bg-[var(--table-libre-bg)] text-[var(--table-libre-text)] border-[var(--table-libre-border)]",
    dotColor: "bg-[#22C55E]",
  },
  ocupada: {
    classes:
      "bg-[var(--table-ocupada-bg)] text-[var(--table-ocupada-text)] border-[var(--table-ocupada-border)]",
    dotColor: "bg-[#FF6B35]",
  },
  pendiente_cobro: {
    classes:
      "bg-[var(--table-cobro-bg)] text-[var(--table-cobro-text)] border-[var(--table-cobro-border)]",
    dotColor: "bg-[#F59E0B]",
  },
};

const COMANDA_STATUS_STYLES: Record<ComandaStatus, { classes: string; dotColor: string }> = {
  nuevo: {
    classes: "bg-[#FF6B35] text-white border-[#FF6B35]",
    dotColor: "bg-white",
  },
  recibido: {
    classes:
      "bg-[var(--kds-recibido-bg)] text-[var(--kds-recibido-text)] border-[var(--kds-recibido-border)]",
    dotColor: "bg-[#3B82F6]",
  },
  preparando: {
    classes:
      "bg-[var(--kds-preparando-bg)] text-[var(--kds-preparando-text)] border-[var(--kds-preparando-border)]",
    dotColor: "bg-[#F59E0B]",
  },
  listo: {
    classes:
      "bg-[var(--kds-listo-bg)] text-[var(--kds-listo-text)] border-[var(--kds-listo-border)]",
    dotColor: "bg-[#22C55E]",
  },
  entregado: {
    classes:
      "bg-[var(--kds-entregado-bg)] text-[var(--kds-entregado-text)] border-[var(--kds-entregado-border)]",
    dotColor: "bg-[#64748B]",
  },
};

const ROLE_STYLES: Record<UserRole, string> = {
  admin:
    "bg-[#172033] text-white border-[#172033] dark:bg-[#2E3F63] dark:border-[#4B6394]",
  mozo: "bg-[var(--pf-orange-soft)] text-[#C2410C] dark:text-[#FF9E7A] border-[#FF6B35]",
  cocina:
    "bg-[var(--kds-preparando-bg)] text-[var(--kds-preparando-text)] border-[var(--kds-preparando-border)]",
  caja: "bg-[var(--kds-listo-bg)] text-[var(--kds-listo-text)] border-[var(--kds-listo-border)]",
};

export function Badge({
  variant = "neutral",
  size = "md",
  tableStatus,
  comandaStatus,
  userRole,
  dot,
  pulse,
  className,
  children,
  ...rest
}: BadgeProps) {
  let colorClasses = GENERIC_VARIANTS[variant];
  let dotColorClass = "bg-current";
  let defaultLabel: string | undefined;
  let shouldDot = Boolean(dot);
  let shouldPulse = Boolean(pulse);

  if (tableStatus) {
    const cfg = TABLE_STATUS_STYLES[tableStatus];
    colorClasses = cfg.classes;
    dotColorClass = cfg.dotColor;
    defaultLabel = TABLE_STATUS_LABELS[tableStatus];
    if (dot === undefined) shouldDot = true;
  } else if (comandaStatus) {
    const cfg = COMANDA_STATUS_STYLES[comandaStatus];
    colorClasses = cfg.classes;
    dotColorClass = cfg.dotColor;
    defaultLabel = COMANDA_STATUS_LABELS[comandaStatus];
    if (dot === undefined) shouldDot = true;
    if (pulse === undefined && comandaStatus === "nuevo") shouldPulse = true;
  } else if (userRole) {
    colorClasses = ROLE_STYLES[userRole];
    defaultLabel = ROLE_LABELS[userRole];
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-bold tracking-wide whitespace-nowrap",
        SIZE_CLASSES[size],
        colorClasses,
        shouldPulse && "animate-kds-new",
        className
      )}
      {...rest}
    >
      {shouldDot && (
        <span
          className={cn("size-2 shrink-0 rounded-full", dotColorClass)}
          aria-hidden="true"
        />
      )}
      {children ?? defaultLabel}
    </span>
  );
}

export interface TableStatusBadgeProps extends Omit<BadgeProps, "tableStatus"> {
  status: TableStatus;
}

export function TableStatusBadge({ status, ...rest }: TableStatusBadgeProps) {
  return <Badge tableStatus={status} {...rest} />;
}

export interface ComandaStatusBadgeProps extends Omit<BadgeProps, "comandaStatus"> {
  status: ComandaStatus;
}

export function ComandaStatusBadge({ status, ...rest }: ComandaStatusBadgeProps) {
  return <Badge comandaStatus={status} {...rest} />;
}

export interface RoleBadgeProps extends Omit<BadgeProps, "userRole" | "role"> {
  role: UserRole;
}

export function RoleBadge({ role, ...rest }: RoleBadgeProps) {
  return <Badge userRole={role} {...rest} />;
}
