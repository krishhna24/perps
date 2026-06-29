"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginBody } from "@/lib/schemas";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { Button, Field, Input, Panel } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginBody>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (values: LoginBody) => {
    setServerError(null);
    try {
      const { token } = await api.login(values);
      login(token);
      router.replace("/trade");
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : "Login failed");
    }
  };

  return (
    <Panel className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Sign in</h2>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...register("email")} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <Input
            type="password"
            autoComplete="current-password"
            {...register("password")}
          />
        </Field>
        {serverError ? (
          <p className="text-sm text-down">{serverError}</p>
        ) : null}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-dim">
        No account?{" "}
        <Link href="/register" className="text-accent hover:underline">
          Create one
        </Link>
      </p>
    </Panel>
  );
}
