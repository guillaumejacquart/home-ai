import { Suspense } from "react";

import { AppsList } from "@/components/AppsList";

export default function AppsPage() {
  return (
    <Suspense fallback={<p className="text-muted">Chargement…</p>}>
      <AppsList />
    </Suspense>
  );
}
