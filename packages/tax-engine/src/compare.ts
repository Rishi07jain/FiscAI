import { TaxProfileSchema, type TaxProfile, type TaxProfileInput } from '@fiscai/shared-types';
import { computeTax, type TaxResult } from './compute';
import { getPack } from './packs';

export interface Lever {
  key: string;
  title: string;
  detail: string;
  regime: 'new' | 'old' | 'both';
  amount: number; // rupees of extra deduction / restructuring
  taxSaved: number;
  ruleId: string;
}

export interface RegimeComparison {
  taxYear: string;
  new: TaxResult;
  old: TaxResult;
  recommended: 'new' | 'old';
  savings: number; // how much the recommended regime saves vs the other
  breakEvenDeductions: number | null; // extra old-regime deductions needed for old to win (0 if it already wins, null if unreachable)
  currentOldDeductions: number;
  levers: Lever[];
  switchRules: { canSwitchEveryYear: boolean; note: string; ruleId: string };
}

const withProfile = (p: TaxProfile, patch: (q: TaxProfile) => void): TaxProfile => {
  const q = structuredClone(p);
  patch(q);
  return q;
};

/** Extra old-regime deductions (beyond what is claimed) after which old beats new. */
export function breakEvenExtraDeductions(profile: TaxProfile): number | null {
  const newTax = computeTax(profile, 'new', { skipMarginal: true }).totalTax;
  const oldAt = (x: number) =>
    computeTax(withProfile(profile, (q) => { q.deductions.sec80G += x; }), 'old', { skipMarginal: true }).totalTax;
  if (oldAt(0) < newTax) return 0;
  let hi = 100000;
  const ceiling = 5_00_00_000;
  while (oldAt(hi) >= newTax) {
    hi *= 2;
    if (hi > ceiling) return null;
  }
  let lo = 0;
  while (hi - lo > 100) {
    const mid = Math.floor((lo + hi) / 2);
    if (oldAt(mid) < newTax) hi = mid; else lo = mid;
  }
  return Math.ceil(hi / 100) * 100;
}

export function compareRegimes(input: TaxProfile | TaxProfileInput): RegimeComparison {
  const profile = TaxProfileSchema.parse(input);
  const n = computeTax(profile, 'new');
  const o = computeTax(profile, 'old');
  const recommended = o.totalTax < n.totalTax ? 'old' : 'new';
  const levers: Lever[] = [];
  const basicDa = profile.salary.basic + profile.salary.da;

  // New-regime lever: employer NPS up to 14% of basic + DA (restructure special allowance).
  const newPack = getPack(profile.taxYear, 'new');
  const npsRoom = Math.max(0, Math.round(basicDa * newPack.deductions.employerNps.pctOfBasicDa) - profile.salary.employerNps);
  if (npsRoom > 0) {
    const moved = withProfile(profile, (q) => {
      q.salary.employerNps += npsRoom;
      q.salary.specialAllowance = Math.max(0, q.salary.specialAllowance - npsRoom);
    });
    const saved = n.totalTax - computeTax(moved, 'new', { skipMarginal: true }).totalTax;
    if (saved > 0) levers.push({ key: 'employerNps', title: 'Route salary into employer NPS', regime: 'both', amount: npsRoom, taxSaved: saved, ruleId: 'DED-80CCD2', detail: `Ask your employer to restructure up to Rs ${npsRoom.toLocaleString('en-IN')} of special allowance as employer NPS contribution (14% of basic + DA). Works in the new regime.` });
  }

  // Old-regime levers: unused headroom.
  const oldPack = getPack(profile.taxYear, 'old');
  const d = profile.deductions;
  const room80C = Math.max(0, oldPack.deductions.sec80C.cap / 100 - d.sec80C - d.homeLoanPrincipal);
  const room1B = Math.max(0, oldPack.deductions.sec80CCD1B.cap / 100 - d.sec80CCD1B);
  const selfCap = (profile.personal.ageBand === 'below60' ? oldPack.deductions.sec80D.self : oldPack.deductions.sec80D.selfSenior) / 100;
  const parentsCap = (profile.personal.parentsSenior ? oldPack.deductions.sec80D.parentsSenior : oldPack.deductions.sec80D.parents) / 100;
  const room80D = Math.max(0, selfCap - d.healthSelf) + Math.max(0, parentsCap - d.healthParents);
  const candidates: [string, string, number, (q: TaxProfile, x: number) => void, string][] = [
    ['sec80C', 'Use the rest of 80C (PPF, ELSS, EPF)', room80C, (q, x) => { q.deductions.sec80C += x; }, 'DED-80C'],
    ['sec80CCD1B', 'Own NPS contribution (extra Rs 50,000)', room1B, (q, x) => { q.deductions.sec80CCD1B += x; }, 'DED-80CCD1B'],
    ['sec80D', 'Health insurance for self and parents', room80D, (q, x) => { const s = Math.max(0, selfCap - q.deductions.healthSelf); q.deductions.healthSelf += Math.min(s, x); q.deductions.healthParents += Math.max(0, x - s); }, 'DED-80D'],
  ];
  for (const [key, title, amt, patch, ruleId] of candidates) {
    if (amt <= 0) continue;
    const t = computeTax(withProfile(profile, (q) => patch(q, amt)), 'old', { skipMarginal: true }).totalTax;
    levers.push({ key, title, amount: amt, regime: 'old', taxSaved: o.totalTax - t, ruleId, detail: `Rs ${amt.toLocaleString('en-IN')} of unused headroom. Saves tax only in the old regime.` });
  }
  if (profile.salary.rentPaid > 0 && profile.salary.hra === 0) {
    levers.push({ key: 'hra', title: 'Ask for an HRA component', regime: 'old', amount: 0, taxSaved: 0, ruleId: 'HRA', detail: 'You pay rent but have no HRA in your salary. An HRA component makes part of it exempt in the old regime.' });
  }

  const hasBusiness = profile.business.fnoProfit !== 0 || profile.business.otherBusinessProfit !== 0 || profile.business.speculativeProfit !== 0 || profile.business.presumptiveIncome > 0;
  const oldDeductions = o.deductions.total + o.income.salary.hraExempt + Math.max(0, -o.income.houseProperty.setOffAllowed);

  return {
    taxYear: profile.taxYear,
    new: n,
    old: o,
    recommended,
    savings: Math.abs(n.totalTax - o.totalTax),
    breakEvenDeductions: breakEvenExtraDeductions(profile),
    currentOldDeductions: oldDeductions,
    levers: levers.sort((a, b) => b.taxSaved - a.taxSaved),
    switchRules: hasBusiness
      ? { canSwitchEveryYear: false, ruleId: 'REGIME-NEW', note: 'You have business income (including F&O). Once you opt out of the new regime you can switch back only once in your lifetime, using Form 10-IEA before the due date.' }
      : { canSwitchEveryYear: true, ruleId: 'REGIME-NEW', note: 'Salaried taxpayers without business income can choose a regime every year when filing the return.' },
  };
}
