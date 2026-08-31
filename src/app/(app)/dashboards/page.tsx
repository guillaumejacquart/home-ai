import { Suspense } from "react";

import { DashboardsList } from "@/components/DashboardsList";

export default function DashboardsPage() {
  return (
    <Suspense fallback={<p className="text-muted">Chargement…</p>}>
      <DashboardsList />
    </Suspense>
  );
}
