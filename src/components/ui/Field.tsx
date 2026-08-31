import type { LabelHTMLAttributes, ReactNode } from "react";

export function Field({
  label,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5" {...props}>
      <span className="text-sm font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
