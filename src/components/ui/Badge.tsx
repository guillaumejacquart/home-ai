import type { HTMLAttributes } from "react";

export type BadgeVariant = "default" | "success" | "danger" | "neutral";

const VARIANTS: Record<BadgeVariant, string> = {
  default: "bg-brand-light text-brand-dark",
  success: "bg-success-light text-success",
  danger: "bg-danger-light text-danger",
  neutral: "bg-neutral-light text-neutral",
};

export function Badge({
  variant = "default",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}