import type { TaxProfile } from '@fiscai/shared-types';
import type { AdvanceTaxPlan, DeductionFinder, HarvestView, ItrPack, PortfolioView, RegimeComparison, ScenarioResult, TaxResult } from '@fiscai/tax-engine';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useApp } from './context';

export function useTY() {
  return useApp().taxYear;
}

/** Invalidate everything derived from the profile. */
export function useInvalidateProfile() {
  const qc = useQueryClient();
  return () => Promise.all(['profile', 'summary', 'compare', 'advance', 'deadlines', 'deductions', 'itr', 'ais', 'vda', 'household', 'portfolio', 'harvest', 'versions'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export const useProfile = () => {
  const ty = useTY();
  return useQuery({ queryKey: ['profile', ty], queryFn: () => api<{ profile: TaxProfile; version: number; updatedAt?: string }>(`/profiles/${ty}`) });
};

export const useSaveProfile = () => {
  const ty = useTY();
  const inv = useInvalidateProfile();
  return useMutation({ mutationFn: (p: TaxProfile) => api(`/profiles/${ty}`, { method: 'PUT', body: p }), onSuccess: () => inv() });
};

export interface Summary {
  profileVersion: number; regime: 'new' | 'old'; result: TaxResult;
  comparison: { new: number; old: number; recommended: 'new' | 'old'; savings: number };
  nextDeadline: { title: string; dueDate: string; amount?: number; ruleId?: string } | null;
}
export const useSummary = () => {
  const ty = useTY();
  return useQuery({ queryKey: ['summary', ty], queryFn: () => api<Summary>(`/tax/summary/${ty}`) });
};
export const useCompare = () => {
  const ty = useTY();
  return useQuery({ queryKey: ['compare', ty], queryFn: () => api<RegimeComparison>(`/tax/compare/${ty}`) });
};
export const useAdvanceTax = () => {
  const ty = useTY();
  return useQuery({ queryKey: ['advance', ty], queryFn: () => api<AdvanceTaxPlan>(`/advance-tax/${ty}`) });
};
export interface Deadline { id: string; type: string; title: string; dueDate: string; ruleId?: string; amount?: number; status: 'open' | 'done' | 'dismissed'; origin: string; triggerEvent?: string; remindAt: string[]; remindersSent: string[] }
export const useDeadlines = () => {
  const ty = useTY();
  return useQuery({ queryKey: ['deadlines', ty], queryFn: () => api<{ deadlines: Deadline[] }>(`/deadlines?taxYear=${ty}`) });
};
export const useDeductions = () => {
  const ty = useTY();
  return useQuery({ queryKey: ['deductions', ty], queryFn: () => api<DeductionFinder>(`/deductions/${ty}`) });
};
export const usePortfolio = () => {
  const ty = useTY();
  return useQuery({ queryKey: ['portfolio', ty], queryFn: () => api<PortfolioView & { syncedToProfile: number }>(`/portfolio?taxYear=${ty}`) });
};
export const useLots = () => useQuery({ queryKey: ['portfolio', 'lots'], queryFn: () => api<{ lots: any[] }>('/portfolio/lots') });
export const useHarvest = () => {
  const ty = useTY();
  return useQuery({ queryKey: ['harvest', ty], queryFn: () => api<HarvestView>(`/portfolio/harvest?taxYear=${ty}`) });
};
export const useItr = () => {
  const ty = useTY();
  return useQuery({ queryKey: ['itr', ty], queryFn: () => api<ItrPack>(`/itr/${ty}`) });
};

export interface SavedScenario { id: string; name: string; type: string; taxYear: string; inputs: any; baseProfileVersion: number; savedAt: string; appliedAt?: string; result: Omit<ScenarioResult, 'afterProfile'> }
export const useScenarios = () => {
  const ty = useTY();
  return useQuery({ queryKey: ['scenarios', ty], queryFn: () => api<{ scenarios: SavedScenario[] }>(`/scenarios?taxYear=${ty}`) });
};

export interface RuleCard { ruleId: string; title: string; body: string; refs: { ita1961: string; ita2025: string }; status: string; sourceUrl: string }
export const useRule = (ruleId?: string) => useQuery({ queryKey: ['rule', ruleId], queryFn: () => api<{ card: RuleCard }>(`/rules/${ruleId}`).then((r) => r.card), enabled: Boolean(ruleId), staleTime: Infinity });
export const useRules = (q = '') => useQuery({ queryKey: ['rules', q], queryFn: () => api<{ cards: RuleCard[] }>(`/rules${q ? `?q=${encodeURIComponent(q)}` : ''}`), staleTime: 60_000 });
