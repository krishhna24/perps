"use client";

import { useToastStore } from "@/store/toastStore";

const styles: Record<string, string> = {
  error: "border-down/50 bg-down/10 text-down",
  success: "border-up/50 bg-up/10 text-up",
  info: "border-border bg-panel2 text-text",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`min-w-64 max-w-sm rounded-md border px-4 py-3 text-left text-sm shadow-lg ${styles[t.type]}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
