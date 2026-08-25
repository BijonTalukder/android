"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/field";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fieldError = (field: string) =>
    error instanceof ApiError ? error.fieldError(field) : undefined;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { email, password });
      // `replace` so the back button does not return to a dead login page.
      router.replace(nextPath.startsWith("/") ? nextPath : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Sign in failed"));
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-5 p-6">
        {/*
          No `name` attributes: if JavaScript ever fails to hydrate, a native
          submit would otherwise GET this page with the credentials in the
          query string, leaking the password into history and server logs.
          Password managers key off `autoComplete`, which still works.
        */}
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Input
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldError("email")}
            placeholder="admin@acme.test"
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldError("password")}
            placeholder="••••••••••"
          />

          {error && !fieldError("email") && !fieldError("password") ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              {error.message}
            </p>
          ) : null}

          <Button type="submit" variant="primary" loading={submitting} className="w-full">
            Sign in
          </Button>
        </form>

        <p className="text-center text-xs text-muted">
          No organization yet?{" "}
          <Link
            href="/register"
            prefetch={false}
            className="font-medium text-accent hover:underline"
          >
            Create one
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Card><CardBody className="p-6 text-sm text-muted">Loading…</CardBody></Card>}>
      <LoginForm />
    </Suspense>
  );
}
