"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const CONTROL =
  "w-full rounded-lg border border-border-base bg-surface px-3 py-2 text-sm text-foreground " +
  "placeholder:text-subtle transition-colors focus:border-accent disabled:opacity-60";

export function Field({
  label,
  error,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  error?: string;
  hint?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, className, id, ...rest },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const control = (
    <input
      ref={ref}
      id={inputId}
      aria-invalid={error ? true : undefined}
      className={cn(CONTROL, error && "border-danger", className)}
      {...rest}
    />
  );
  if (!label) return control;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={inputId}>
      {control}
    </Field>
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode;
  error?: string;
  hint?: ReactNode;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, className, id, children, ...rest },
  ref,
) {
  const generated = useId();
  const selectId = id ?? generated;
  const control = (
    <select
      ref={ref}
      id={selectId}
      className={cn(CONTROL, "pr-8", error && "border-danger", className)}
      {...rest}
    >
      {children}
    </select>
  );
  if (!label) return control;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={selectId}>
      {control}
    </Field>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  error?: string;
  hint?: ReactNode;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, className, id, ...rest },
  ref,
) {
  const generated = useId();
  const areaId = id ?? generated;
  const control = (
    <textarea
      ref={ref}
      id={areaId}
      className={cn(CONTROL, "resize-y", error && "border-danger", className)}
      {...rest}
    />
  );
  if (!label) return control;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={areaId}>
      {control}
    </Field>
  );
});
