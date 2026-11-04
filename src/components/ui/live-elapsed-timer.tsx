"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, Clock, Flame } from "lucide-react";
import { cn } from "./cn";

export type SlaLevel = "normal" | "warn" | "critical";

export interface LiveElapsedTimerProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Timestamp ISO, epoch ms o Date de inicio (ej. comanda.created_at) */
  since: string | number | Date;
  /** Timestamp opcional de fin para congelar el cronómetro (ej. delivered_at) */
  pausedAt?: string | number | Date | null;
  /** Minutos a partir de los cuales pasa a estado warn (default: 8) */
  warnMinutes?: number;
  /** Minutos a partir de los cuales pasa a estado critical (default: 15) */
  criticalMinutes?: number;
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
}

export function getSlaLevel(
  elapsedMinutes: number,
  warnMinutes = 8,
  criticalMinutes = 15
): SlaLevel {
  if (elapsedMinutes >= criticalMinutes) return "critical";
  if (elapsedMinutes >= warnMinutes) return "warn";
  return "normal";
}

/**
 * Formatea segundos transcurridos:
 * - Menos de 60 min -> "mm:ss" (ej. "07:42")
 * - 60 min o más    -> "hh:mm" (ej. "01:15")
 */
export function formatElapsedClock(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));

  if (safeSeconds < 3600) {
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function toTimestampMs(input: string | number | Date): number {
  if (typeof input === "number") return input;
  if (input instanceof Date) return input.getTime();
  const parsed = Date.parse(input);
  return Number.isNaN(parsed) ? 0 : parsed;
}

const SLA_STYLES: Record<SlaLevel, string> = {
  normal:
    "bg-[var(--sla-normal-bg)] text-[var(--sla-normal-text)] border-[var(--sla-normal-border)]",
  warn: "bg-[var(--sla-warn-bg)] text-[var(--sla-warn-text)] border-[var(--sla-warn-border)]",
  critical:
    "bg-[var(--sla-critical-bg)] text-[var(--sla-critical-text)] border-[var(--sla-critical-border)]",
};

const SIZE_STYLES: Record<NonNullable<LiveElapsedTimerProps["size"]>, string> = {
  sm: "px-2 py-0.5 text-xs gap-1",
  md: "px-2.5 py-1 text-sm gap-1.5",
  lg: "px-3 py-1.5 text-base gap-1.5",
};

export function LiveElapsedTimer({
  since,
  pausedAt = null,
  warnMinutes = 8,
  criticalMinutes = 15,
  size = "md",
  showIcon = true,
  className,
  ...rest
}: LiveElapsedTimerProps) {
  const startMs = toTimestampMs(since);
  const pausedMs = pausedAt != null ? toTimestampMs(pausedAt) : null;

  const [nowMs, setNowMs] = useState<number | null>(() =>
    pausedMs != null ? pausedMs : null
  );

  useEffect(() => {
    if (pausedMs != null) {
      setNowMs(pausedMs);
      return;
    }

    setNowMs(Date.now());
    const timerId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [pausedMs, startMs]);

  const effectiveEndMs = pausedMs ?? nowMs;
  const elapsedSeconds =
    effectiveEndMs != null && startMs > 0
      ? Math.max(0, Math.floor((effectiveEndMs - startMs) / 1000))
      : 0;

  const elapsedMinutes = elapsedSeconds / 60;
  const slaLevel: SlaLevel =
    effectiveEndMs != null
      ? getSlaLevel(elapsedMinutes, warnMinutes, criticalMinutes)
      : "normal";

  const formatted = effectiveEndMs != null ? formatElapsedClock(elapsedSeconds) : "--:--";

  const IconComponent =
    slaLevel === "critical" ? Flame : slaLevel === "warn" ? AlertTriangle : Clock;

  return (
    <span
      role="timer"
      aria-live="off"
      data-sla={slaLevel}
      title={`Antigüedad: ${Math.floor(elapsedMinutes)} min`}
      suppressHydrationWarning
      className={cn(
        "tabular-nums inline-flex items-center rounded-full border font-extrabold whitespace-nowrap",
        SLA_STYLES[slaLevel],
        SIZE_STYLES[size],
        className
      )}
      {...rest}
    >
      {showIcon && <IconComponent className="size-3.5 shrink-0" aria-hidden="true" />}
      <span>{formatted}</span>
    </span>
  );
}
