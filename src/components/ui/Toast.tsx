"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

export type ToastVariant = "success" | "danger" | "info";

type Toast = { id: number; message: string; variant: ToastVariant };

const DURATION_MS = 3500;

const ToastContext = createContext<(message: string, variant?: ToastVariant) => void>(
  () => {},
);

/** Affiche un message éphémère en bas à droite. */
export function useToast() {
  return useContext(ToastContext);
}

const STYLES: Record<ToastVariant, string> = {
  success: "border-success bg-success-light text-success",
  danger: "border-danger bg-danger-light text-danger",
  info: "border-brand bg-brand-light text-brand-dark",
};

const ICONS: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  danger: XCircle,
  info: Info,
};

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, variant: ToastVariant = "success") => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.variant];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-card ${STYLES[t.variant]}`}
            >
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
