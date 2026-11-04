"use client";

import React, { useEffect, useId } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";

export type ModalSheetSize = "sm" | "md" | "lg" | "xl";

export interface ModalSheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalSheetSize;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  className?: string;
  children: React.ReactNode;
  "data-testid"?: string;
}

const DESKTOP_MAX_WIDTH: Record<ModalSheetSize, string> = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
};

export function ModalSheet({
  open,
  onClose,
  title,
  description,
  footer,
  size = "md",
  closeOnBackdrop = true,
  closeOnEscape = true,
  className,
  children,
  "data-testid": dataTestId,
}: ModalSheetProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, closeOnEscape, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="presentation"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 transition-opacity"
        aria-hidden="true"
        onClick={closeOnBackdrop ? onClose : undefined}
      />

      {/* Panel: Bottom-Sheet en móvil, Modal centrado en sm+ */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        data-testid={dataTestId}
        className={cn(
          "relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden",
          "rounded-t-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-2xl",
          "animate-sheet-up sm:rounded-2xl sm:animate-modal-pop",
          DESKTOP_MAX_WIDTH[size],
          className
        )}
      >
        {/* Indicador visual de arrastre en móvil */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden" aria-hidden="true">
          <span className="h-1.5 w-12 rounded-full bg-[var(--border-strong)]" />
        </div>

        {/* Cabecera */}
        {(title || description) && (
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-6 sm:py-4">
            <div className="min-w-0 flex-1">
              {title && (
                <h2
                  id={titleId}
                  className="text-lg font-extrabold tracking-tight text-[var(--text-primary)] sm:text-xl"
                >
                  {title}
                </h2>
              )}
              {description && (
                <p
                  id={descriptionId}
                  className="mt-0.5 text-sm text-[var(--text-secondary)]"
                >
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar ventana"
              className="touch-target -mr-1 inline-flex shrink-0 items-center justify-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[#FF6B35] focus-visible:outline-none cursor-pointer"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        )}

        {!title && !description && (
          <div className="flex justify-end px-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar ventana"
              className="touch-target inline-flex items-center justify-center rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Cuerpo desplazable */}
        <div
          className={cn(
            "flex-1 overflow-y-auto px-4 py-4 sm:px-6",
            !footer && "pb-safe"
          )}
        >
          {children}
        </div>

        {/* Pie fijo opcional */}
        {footer && (
          <div className="pb-safe border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 pt-3 sm:px-6 sm:py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
