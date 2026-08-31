import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function EmptyState({
  icon = <Inbox className="size-6" />,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-brand-light text-brand-dark">
        {icon}
      </div>
      <p className="font-semibold text-ink">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}