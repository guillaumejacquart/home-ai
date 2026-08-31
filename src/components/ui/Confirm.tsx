"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { Button } from "./Button";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type Pending = { options: ConfirmOptions; resolve: (ok: boolean) => void };

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(
  async () => false,
);

/** Remplace `window.confirm` par une boîte de dialogue aux couleurs de l'app. */
export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ options, resolve })),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      setPending((current) => {
        current?.resolve(ok);
        return null;
      });
    },
    [],
  );

  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, close]);

  const options = pending?.options;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4 backdrop-blur-sm"
          onClick={() => close(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby={options.description ? "confirm-description" : undefined}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-card border border-line bg-card p-5 shadow-card-hover"
          >
            <h2 id="confirm-title" className="font-semibold text-ink">
              {options.title}
            </h2>
            {options.description && (
              <p id="confirm-description" className="mt-1.5 text-sm text-muted">
                {options.description}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => close(false)}>
                {options.cancelLabel ?? "Annuler"}
              </Button>
              <Button
                ref={confirmRef}
                variant={options.danger === false ? "primary" : "danger"}
                size="sm"
                onClick={() => close(true)}
              >
                {options.confirmLabel ?? "Supprimer"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
