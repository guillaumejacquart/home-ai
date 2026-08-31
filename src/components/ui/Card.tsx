import type { HTMLAttributes } from "react";

export function Card({
  className = "",
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={`rounded-card border border-line bg-card p-5 shadow-card ${
        interactive
          ? "transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-card-hover"
          : ""
      } ${className}`}
      {...props}
    />
  );
}