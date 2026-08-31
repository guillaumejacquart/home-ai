import { Suspense } from "react";

import { ScriptsManager } from "@/components/ScriptsManager";

export default function ScriptsPage() {
  return (
    <Suspense fallback={<p className="text-muted">Chargement…</p>}>
      <ScriptsManager />
    </Suspense>
  );
}
