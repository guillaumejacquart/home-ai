import { Suspense } from "react";

import { StorageEditClient } from "@/components/storage/StorageEditClient";

export default function StorageEditRoute() {
  return (
    <Suspense fallback={<p className="text-muted">Chargement…</p>}>
      <StorageEditClient />
    </Suspense>
  );
}
