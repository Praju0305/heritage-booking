import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from '../api';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(tokenStore.get());
  const [loading, setLoading] = useState<boolean>(!!tokenStore.get());

  // Restore session: the server re-validates the token and returns the DB-backed role.
  useEffect(() => {
    if (!tokenStore.get()) return;
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => {
        tokenStore.clear();
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const accept = useCallback((t: string, u: User) => {
    tokenStore.set(t);
    setToken(t);
    setUser(u);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      loading,
      login: async (email, password) => {
        const r = await api.login({ email, password });
        accept(r.token, r.user);
      },
      register: async (name, email, password) => {
        const r = await api.register({ name, email, password });
        accept(r.token, r.user);
      },
      logout: () => {
        tokenStore.clear();
        setToken(null);
        setUser(null);
      },
    }),
    [user, token, loading, accept],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
