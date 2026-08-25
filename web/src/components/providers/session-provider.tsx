"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import type { SessionUserDto } from "@/modules/auth/auth.dto";
import { ROLES } from "@/types";

type SessionState = {
  user: SessionUserDto | null;
  loading: boolean;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
  isSuperAdmin: boolean;
  /** SUPER_ADMIN or ORGANIZATION_ADMIN: may mutate devices, users, commands. */
  canManage: boolean;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUserDto | null>(null);
  const [loading, setLoading] = useState(true);

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(async () => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // The whole body runs after an await, so no state is written during the
    // effect itself -- only once the request settles.
    void (async () => {
      try {
        const data = await api.get<{ user: SessionUserDto }>("/api/auth/me");
        if (!cancelled) setUser(data.user);
      } catch (error) {
        if (cancelled) return;
        setUser(null);
        // 401 means the refresh cookie is gone too; anything else is a real
        // failure the dashboard shell surfaces as a dead session.
        if (error instanceof ApiError && error.status === 401) {
          router.replace("/login");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, nonce]);

  const signOut = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      setUser(null);
      router.replace("/login");
      router.refresh();
    }
  }, [router]);

  const value = useMemo<SessionState>(
    () => ({
      user,
      loading,
      reload,
      signOut,
      isSuperAdmin: user?.role === ROLES.SUPER_ADMIN,
      canManage:
        user?.role === ROLES.SUPER_ADMIN || user?.role === ROLES.ORGANIZATION_ADMIN,
    }),
    [user, loading, reload, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside a SessionProvider");
  return context;
}
