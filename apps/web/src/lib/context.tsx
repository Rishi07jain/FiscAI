import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';

export interface User {
  id: string; email: string; name: string; activeTaxYear: string; onboardedAt?: string; createdAt: string;
  consentFlags: { terms: boolean; documentProcessing: boolean; emailReminders: boolean; keepUploadedFiles: boolean };
  metrics?: { scenariosRun: number; taxSavedEstimate: number; firstSummaryAt?: string; firstUploadAt?: string };
}

interface AppCtx {
  user: User | null | undefined;
  loading: boolean;
  refreshUser: () => Promise<void>;
  taxYear: '2025-26' | '2026-27';
  setTaxYear: (y: '2025-26' | '2026-27') => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  config?: { features: { llm: boolean; queue: string; email: string; vectorSearch: string }; disclaimer: string };
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try { return (await api<{ user: User }>('/me')).user; } catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; }
    },
    staleTime: 60_000,
  });
  const config = useQuery({ queryKey: ['config'], queryFn: () => api('/config'), staleTime: Infinity });
  const [taxYear, setTY] = useState<'2025-26' | '2026-27'>('2026-27');
  useEffect(() => { if (me.data?.activeTaxYear) setTY(me.data.activeTaxYear as any); }, [me.data?.activeTaxYear]);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      try { localStorage.setItem('fiscai-theme', next); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const setTaxYear = useCallback((y: '2025-26' | '2026-27') => {
    setTY(y);
    api('/me', { method: 'PATCH', body: { activeTaxYear: y } }).catch(() => undefined);
  }, []);
  const value = useMemo<AppCtx>(() => ({
    user: me.data, loading: me.isLoading, refreshUser: async () => { await qc.invalidateQueries({ queryKey: ['me'] }); },
    taxYear, setTaxYear, theme, toggleTheme, config: config.data,
  }), [me.data, me.isLoading, qc, taxYear, setTaxYear, theme, toggleTheme, config.data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}
