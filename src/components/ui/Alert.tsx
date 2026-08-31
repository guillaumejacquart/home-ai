import type { ReactNode } from "react";

export type AlertVariant = "danger" | "success" | "info";

const VARIANTS: Record<AlertVariant, string> = {
  danger: "border-danger bg-danger-light text-danger",
  success: "border-success bg-success-light text-success",
  info: "border-brand bg-brand-light text-brand-dark",
};

/**
 * Bandeau de message. `role="alert"` pour les erreurs (annoncé immédiatement),
 * `role="status"` pour le reste (annoncé sans interrompre).
 */
export function Alert({
  variant = "danger",
  className = "",
  children,
}: {
  variant?: AlertVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={variant === "danger" ? "alert" : "status"}
      className={`rounded-lg border px-4 py-2 text-sm ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </div>
  );
}
