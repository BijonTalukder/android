"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useSession } from "@/components/providers/session-provider";

type NavItem = { href: string; label: string; superAdminOnly?: boolean };

const ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/devices", label: "Devices" },
  { href: "/dashboard/commands", label: "Commands" },
  { href: "/dashboard/logs", label: "Logs" },
  { href: "/dashboard/organizations", label: "Organizations", superAdminOnly: true },
  { href: "/dashboard/settings", label: "Settings" },
];

export function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { isSuperAdmin } = useSession();

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin).map((item) => {
        const active =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-surface-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
