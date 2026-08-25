import type { ReactNode } from "react";
import { SessionProvider } from "@/components/providers/session-provider";
import { ToastProvider } from "@/components/providers/toast-provider";
import { DashboardShell } from "@/components/dashboard/shell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SessionProvider>
        <DashboardShell>{children}</DashboardShell>
      </SessionProvider>
    </ToastProvider>
  );
}
