import { Suspense } from "react";

import { ConnectionsManager } from "@/components/ConnectionsManager";

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<p className="text-muted">Chargement…</p>}>
      <ConnectionsManager />
    </Suspense>
  );
}
