"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema, type RegisterBody } from "@/lib/schemas";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { Button, Field, Input, Panel } from "@/components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterBody>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (values: RegisterBody) => {
    setServerError(null);
    try {
      const { token } = await api.register(values);
      login(token);
      router.replace("/trade");
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : "Registration failed");
    }
  };

  return (
    <Panel className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Create account</h2>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Field label="Username" error={errors.username?.message}>
          <Input autoComplete="username" {...register("username")} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...register("email")} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <Input
            type="password"
            autoComplete="new-password"
            {...register("password")}
          />
        </Field>
        {serverError ? (
          <p className="text-sm text-down">{serverError}</p>
        ) : null}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating…" : "Create account"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-dim">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </Panel>
  );
}
