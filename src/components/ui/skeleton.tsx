import React from "react";
import { cn } from "./cn";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  rounded?: "sm" | "md" | "lg" | "full";
}

const ROUNDED_CLASSES: Record<NonNullable<SkeletonProps["rounded"]>, string> = {
  sm: "rounded-md",
  md: "rounded-xl",
  lg: "rounded-2xl",
  full: "rounded-full",
};

export function Skeleton({
  rounded = "md",
  className,
  ...rest
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse bg-[var(--bg-muted)]",
        ROUNDED_CLASSES[rounded],
        className
      )}
      {...rest}
    />
  );
}

export function TableCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex min-h-[120px] flex-col justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-6 w-20" />
        <Skeleton rounded="full" className="h-5 w-16" />
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-28" />
      </div>
    </div>
  );
}

export function KdsCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-24" />
        <Skeleton rounded="full" className="h-7 w-20" />
      </div>
      <Skeleton rounded="full" className="h-5 w-28" />
      <div className="space-y-2.5 border-y border-[var(--border-subtle)] py-3">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-2/3" />
      </div>
      <Skeleton rounded="lg" className="h-14 w-full" />
    </div>
  );
}

export function ProductRowSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5"
    >
      <div className="flex-1 space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="size-12 shrink-0" />
    </div>
  );
}
