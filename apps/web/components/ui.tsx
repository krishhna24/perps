"use client";

import { forwardRef } from "react";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className = "", ...props }, ref) => (
  <input
    ref={ref}
    className={`w-full rounded-md border border-border bg-panel2 px-3 py-2 text-sm text-text outline-none placeholder:text-dim focus:border-accent ${className}`}
    {...props}
  />
));
Input.displayName = "Input";

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-dim">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-down">{error}</span> : null}
    </label>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "up" | "down";
};

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonProps) {
  const variants: Record<string, string> = {
    primary: "bg-accent text-black hover:opacity-90",
    ghost: "border border-border bg-transparent text-text hover:bg-panel2",
    up: "bg-up text-black hover:opacity-90",
    down: "bg-down text-white hover:opacity-90",
  };
  return (
    <button
      className={`rounded-md px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Panel({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-border bg-panel ${className}`}
    >
      {children}
    </div>
  );
}

export function PanelHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-dim">
      {children}
    </div>
  );
}
