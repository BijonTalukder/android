"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/components/providers/session-provider";
import { Spinner } from "@/components/ui/states";
import { titleCase } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Nav } from "./nav";

export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Loading your workspace" />
      </div>
    );
  }

  // The proxy already bounced anonymous visitors; this covers a session that
  // died while the tab was open.
  if (!user) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted">Your session has ended.</p>
        <Link href="/login">
          <Button variant="primary">Sign in again</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside
        className={cn(
          "border-border-base bg-surface lg:sticky lg:top-0 lg:h-dvh lg:border-r",
          "lg:flex lg:flex-col",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border-base px-4 py-3.5 lg:border-b-0">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-contrast">
              G
            </span>
            <span className="text-sm font-semibold text-foreground">Device Gateway</span>
          </Link>
          <Button
            size="sm"
            variant="ghost"
            className="lg:hidden"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? "Close" : "Menu"}
          </Button>
        </div>

        <div
          className={cn(
            "px-3 pb-4 lg:flex lg:flex-1 lg:flex-col lg:justify-between",
            mobileOpen ? "block border-b border-border-base" : "hidden lg:block",
          )}
        >
          <div className="pt-3">
            <Nav onNavigate={() => setMobileOpen(false)} />
          </div>

          <div className="mt-6 space-y-3 rounded-lg bg-surface-muted p-3 lg:mt-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="accent">{titleCase(user.role)}</Badge>
              {user.organization ? (
                <Badge>{user.organization.name}</Badge>
              ) : (
                <Badge tone="warning">All organizations</Badge>
              )}
            </div>
            <Button size="sm" className="w-full" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}
