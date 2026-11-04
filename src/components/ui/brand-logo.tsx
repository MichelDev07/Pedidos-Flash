import React from "react";
import { cn } from "./cn";

export interface BrandLogoProps {
  /** "mark" renderiza solo el isotipo; "full" incluye texto Pedidos Flash */
  variant?: "mark" | "full";
  size?: "sm" | "md" | "lg" | "xl";
  /** Muestra el eslogan oficial debajo del nombre */
  showSlogan?: boolean;
  /** Fuerza texto blanco cuando se ubica sobre fondos siempre oscuros (#172033) */
  invertText?: boolean;
  businessName?: string;
  slogan?: string;
  className?: string;
}

const MARK_DIMENSIONS: Record<NonNullable<BrandLogoProps["size"]>, number> = {
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
};

const TEXT_CLASSES: Record<NonNullable<BrandLogoProps["size"]>, string> = {
  sm: "text-lg",
  md: "text-xl",
  lg: "text-2xl",
  xl: "text-3xl",
};

export function BrandLogo({
  variant = "full",
  size = "md",
  showSlogan = false,
  invertText = false,
  businessName = "Pedidos Flash",
  slogan = "De la mesa a la cocina, en un flash.",
  className,
}: BrandLogoProps) {
  const px = MARK_DIMENSIONS[size];
  const isDefaultBrand = businessName.trim().toLowerCase() === "pedidos flash";

  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <svg
        width={px}
        height={px}
        viewBox="0 0 512 512"
        fill="none"
        aria-hidden={variant === "full" ? "true" : undefined}
        role={variant === "mark" ? "img" : undefined}
        aria-label={variant === "mark" ? businessName : undefined}
        className="shrink-0 drop-shadow-xs"
      >
        <rect width="512" height="512" rx="112" fill="#172033" />
        <rect
          x="10"
          y="10"
          width="492"
          height="492"
          rx="104"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="12"
        />
        <circle cx="256" cy="148" r="22" fill="#FFFFFF" />
        <path
          d="M104 332C104 248.053 172.053 180 256 180C339.947 180 408 248.053 408 332H104Z"
          fill="#FFFFFF"
        />
        <rect x="84" y="352" width="344" height="34" rx="17" fill="#FFFFFF" />
        <path
          d="M288 108L192 268H262L224 412L338 236H264L288 108Z"
          stroke="#172033"
          strokeWidth="26"
          strokeLinejoin="round"
        />
        <path d="M288 108L192 268H262L224 412L338 236H264L288 108Z" fill="#FF6B35" />
      </svg>

      {variant === "full" && (
        <div className="flex flex-col leading-none">
          <span
            className={cn(
              "font-extrabold tracking-tight",
              TEXT_CLASSES[size],
              invertText ? "text-white" : "text-[var(--text-primary)]"
            )}
          >
            {isDefaultBrand ? (
              <>
                Pedidos <span className="italic text-[#FF6B35]">Flash</span>
              </>
            ) : (
              businessName
            )}
          </span>
          {showSlogan && (
            <span
              className={cn(
                "mt-1 text-xs font-medium leading-tight",
                invertText ? "text-slate-300" : "text-[var(--text-secondary)]"
              )}
            >
              {slogan}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
