"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/field";

/**
 * Self-serve organization signup.
 *
 * The API refuses this unless ALLOW_PUBLIC_REGISTRATION is on, so the page
 * surfaces that refusal rather than pretending the option exists.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    organizationName: "",
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const fieldError = (field: string) =>
    error instanceof ApiError ? error.fieldError(field) : undefined;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/auth/register", form);
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Registration failed"));
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-5 p-6">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Input
            label="Organization name"
            required
            value={form.organizationName}
            onChange={set("organizationName")}
            error={fieldError("organizationName")}
            placeholder="Acme Logistics"
          />
          <Input
            label="Your name"
            required
            value={form.name}
            onChange={set("name")}
            error={fieldError("name")}
            placeholder="Jane Doe"
          />
          <Input
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={form.email}
            onChange={set("email")}
            error={fieldError("email")}
            placeholder="jane@acme.test"
          />
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            value={form.password}
            onChange={set("password")}
            error={fieldError("password")}
            hint="At least 10 characters, with upper case, lower case and a digit."
          />

          {error && Object.keys((error as ApiError).errors ?? {}).length === 0 ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              {error.message}
            </p>
          ) : null}

          <Button type="submit" variant="primary" loading={submitting} className="w-full">
            Create organization
          </Button>
        </form>

        <p className="text-center text-xs text-muted">
          Already have an account?{" "}
          <Link
            href="/login"
            prefetch={false}
            className="font-medium text-accent hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
