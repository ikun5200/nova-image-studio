'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { NovaUser, PublicSettings } from '@/lib/auth-client';
import { readSessionSnapshot } from '@/lib/session-store';

export interface SessionContextValue {
  user: NovaUser;
  settings: PublicSettings;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ value, children }: { value: SessionContextValue; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession 必须在 SessionProvider 内使用');
  return value;
}

export function useOptionalSession(): SessionContextValue | null {
  const context = useContext(SessionContext);
  if (context) return context;
  const snapshot = readSessionSnapshot();
  if (!snapshot) return null;
  return {
    user: snapshot.user,
    settings: snapshot.settings,
    refresh: async () => {},
    logout: async () => {
      const { logout } = await import('@/lib/auth-client');
      const { clearSessionSnapshot } = await import('@/lib/session-store');
      try {
        await logout();
      } finally {
        clearSessionSnapshot();
        window.location.replace('/login/');
      }
    },
  };
}
