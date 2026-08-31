import { Suspense } from "react";

import { StoragePage } from "@/components/StoragePage";

export default function StorageRoute() {
  return (
    <Suspense fallback={<p className="text-muted">Chargement…</p>}>
      <StoragePage />
    </Suspense>
  );
}