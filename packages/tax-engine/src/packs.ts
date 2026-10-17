import { rulePacks } from '@fiscai/rule-packs';
import type { Regime, TaxYear } from '@fiscai/shared-types';

export interface Slab { upTo: number | null; rate: number }
export interface SurchargeTier { above: number; rate: number }

export interface RulePack {
  id: string;
  act: string;
  taxYear: string;
  regime: Regime;
  effectiveFrom: string;
  cess: number;
  rounding: { totalIncomeTo: number; taxTo: number };
  slabs: Record<'below60' | '60to79' | '80plus', Slab[]>;
  standardDeduction: number;
  rebate: { maxIncome: number; maxRebate: number; marginalRelief: boolean; residentOnly: boolean; excludes: string[]; ruleId: string };
  surcharge: SurchargeTier[];
  specialRates: {
    equitySTCG: { rate: number; ruleId: string };
    equityLTCG: { rate: number; exemption: number; ruleId: string };
    otherLTCG: { rate: number; ruleId: string };
    propertyGrandfather: { cutoffDate: string; indexedRate: number; ruleId: string };
    vda: { rate: number; lossSetOff: boolean; tdsRate: number; ruleId: string };
    promoterBuyback: { rate: number; ruleId: string };
    specialSurchargeCap: number;
  };
  holdingPeriods: Record<string, number | null>;
  cii: Record<string, number | { value: number; provisional: boolean }>;
  capitalGainsExemptions: {
    sec54: { cap: number; ruleId: string };
    sec54F: { cap: number; ruleId: string };
    sec54EC: { cap: number; windowMonths: number; ruleId: string };
  };
  lossCarryForwardYears: Record<string, number>;
  advanceTax: {
    threshold: number;
    interestRatePerMonth: number;
    instalments: { due: string; cumulativePct: number }[];
    ruleIds: { b: string; c: string };
  };
  returnDueDates: Record<string, string>;
  fno: {
    sttOld: { futures: number; optionsPremium: number; optionsExercise: number };
    sttNew: { futures: number; optionsPremium: number; optionsExercise: number };
    auditTurnover: number;
    effectiveFrom: string;
  };
  hra: { metroPct: number; nonMetroPct: number; rentExcessPct: number; metros: string[] };
  deductions: Record<string, any> & { allowed: string[] };
  exemptions: {
    hra: boolean;
    professionalTax: boolean;
    houseProperty: { selfOccupiedInterest: boolean; selfOccupiedCap?: number; lossSetOffOtherHeads: boolean; lossSetOffCap?: number };
  };
  buybackTreatment: 'capital_gains' | 'deemed_dividend';
  familyPensionDeduction: { fraction: number; cap: number };
  professionalTaxCap: number;
  refs: Record<string, { ita1961: string; ita2025: string }>;
  sources: { title: string; url: string }[];
}

const PACKS = rulePacks as unknown as RulePack[];

export function listPacks(): RulePack[] {
  return PACKS;
}

export function getPack(taxYear: TaxYear | string, regime: Regime): RulePack {
  const p = PACKS.find((x) => x.taxYear === taxYear && x.regime === regime);
  if (!p) throw new Error(`No rule pack for Tax Year ${taxYear} (${regime} regime)`);
  return p;
}

export function ciiFor(pack: RulePack, fy: string): { value: number; provisional: boolean } {
  const v = pack.cii[fy];
  if (v === undefined) {
    // Before 2001-02 the base year applies (cost = FMV on 1 Apr 2001).
    if (fy < '2001-02') return { value: 100, provisional: false };
    const keys = Object.keys(pack.cii).sort();
    const last = pack.cii[keys[keys.length - 1]];
    return typeof last === 'number' ? { value: last, provisional: true } : { value: last.value, provisional: true };
  }
  return typeof v === 'number' ? { value: v, provisional: false } : v;
}

export function isMetro(pack: RulePack, city: string): boolean {
  return pack.hra.metros.includes(city.trim().toLowerCase());
}
