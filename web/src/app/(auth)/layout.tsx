import type { ReactNode } from "react";
import { ToastProvider } from "@/components/providers/toast-provider";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-contrast">
              G
            </div>
            <h1 className="text-lg font-semibold text-foreground">
              Android Device Gateway
            </h1>
            <p className="mt-1 text-sm text-muted">
              Manage your fleet of Android gateway devices.
            </p>
          </div>
          {children}
        </div>
      </main>
    </ToastProvider>
  );
}
