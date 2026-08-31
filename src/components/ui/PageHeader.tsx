import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  count,
  badge,
  actions,
}: {
  title: string;
  description?: string;
  count?: number;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-brand-dark">{title}</h1>
          {badge}
          {count != null && (
            <span className="rounded-full bg-brand-light px-2 py-0.5 text-xs font-semibold text-brand-dark">
              {count}
            </span>
          )}
        </div>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}