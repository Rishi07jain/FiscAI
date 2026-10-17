import { TaxProfileSchema, type TaxProfile, type TaxProfileInput } from '@fiscai/shared-types';
import { computeTax } from './compute';
import { getPack } from './packs';

export interface Headroom {
  key: string;
  label: string;
  ruleId: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  regimes: ('new' | 'old')[];
  taxSavedIfFilled: { old: number; new: number };
}

export interface Scheme {
  key: string;
  name: string;
  section: string;
  ruleId: string;
  eligible: boolean;
  eligibilityNote: string;
  lockIn: string;
  suggestedAmount: number;
  taxBenefit: { old: number; new: number };
  shownBecause: string;
}

export interface DeductionFinder {
  regime: 'new' | 'old';
  headroom: Headroom[];
  schemes: Scheme[];
  note: string;
}

const clone = <T>(x: T): T => structuredClone(x);

export function deductionFinder(input: TaxProfile | TaxProfileInput): DeductionFinder {
  const profile = TaxProfileSchema.parse(input);
  const oldPack = getPack(profile.taxYear, 'old');
  const newPack = getPack(profile.taxYear, 'new');
  const baseOld = computeTax(profile, 'old', { skipMarginal: true }).totalTax;
  const baseNew = computeTax(profile, 'new', { skipMarginal: true }).totalTax;
  const savedBy = (patch: (q: TaxProfile) => void) => {
    const q = clone(profile);
    patch(q);
    return {
      old: baseOld - computeTax(q, 'old', { skipMarginal: true }).totalTax,
      new: baseNew - computeTax(q, 'new', { skipMarginal: true }).totalTax,
    };
  };
  const d = profile.deductions;
  const senior = profile.personal.ageBand !== 'below60';
  const basicDa = profile.salary.basic + profile.salary.da;
  const od = oldPack.deductions;
  const R = (p: number) => Math.round(p / 100);

  const h: Headroom[] = [];
  const used80C = d.sec80C + d.homeLoanPrincipal;
  const rem80C = Math.max(0, R(od.sec80C.cap) - used80C);
  h.push({ key: 'sec80C', label: '80C (PPF, ELSS, EPF, life cover, home-loan principal)', ruleId: 'DED-80C', limit: R(od.sec80C.cap), used: used80C, remaining: rem80C, regimes: ['old'], taxSavedIfFilled: savedBy((q) => { q.deductions.sec80C += rem80C; }) });
  const rem1B = Math.max(0, R(od.sec80CCD1B.cap) - d.sec80CCD1B);
  h.push({ key: 'sec80CCD1B', label: 'Own NPS (80CCD(1B))', ruleId: 'DED-80CCD1B', limit: R(od.sec80CCD1B.cap), used: d.sec80CCD1B, remaining: rem1B, regimes: ['old'], taxSavedIfFilled: savedBy((q) => { q.deductions.sec80CCD1B += rem1B; }) });
  const selfCap = R(senior ? od.sec80D.selfSenior : od.sec80D.self);
  const remSelf = Math.max(0, selfCap - d.healthSelf);
  h.push({ key: 'sec80D', label: 'Health insurance – self & family (80D)', ruleId: 'DED-80D', limit: selfCap, used: d.healthSelf, remaining: remSelf, regimes: ['old'], taxSavedIfFilled: savedBy((q) => { q.deductions.healthSelf += remSelf; }) });
  const parCap = R(profile.personal.parentsSenior ? od.sec80D.parentsSenior : od.sec80D.parents);
  const remPar = Math.max(0, parCap - d.healthParents);
  h.push({ key: 'sec80DParents', label: 'Health insurance – parents (80D)', ruleId: 'DED-80D', limit: parCap, used: d.healthParents, remaining: remPar, regimes: ['old'], taxSavedIfFilled: savedBy((q) => { q.deductions.healthParents += remPar; }) });
  const npsLimitNew = Math.round(basicDa * newPack.deductions.employerNps.pctOfBasicDa);
  const remNps = Math.max(0, npsLimitNew - profile.salary.employerNps);
  if (basicDa > 0) h.push({ key: 'employerNps', label: 'Employer NPS (80CCD(2)) – 14% of basic + DA', ruleId: 'DED-80CCD2', limit: npsLimitNew, used: profile.salary.employerNps, remaining: remNps, regimes: ['new', 'old'], taxSavedIfFilled: savedBy((q) => { q.salary.employerNps += remNps; q.salary.specialAllowance = Math.max(0, q.salary.specialAllowance - remNps); }) });
  const ttaCap = R(senior ? od.sec80TTB.cap : od.sec80TTA.cap);
  const ttaUsed = Math.min(ttaCap, senior ? profile.otherIncome.savingsInterest + profile.otherIncome.fdInterest : profile.otherIncome.savingsInterest);
  h.push({ key: senior ? 'sec80TTB' : 'sec80TTA', label: senior ? 'Interest income (80TTB)' : 'Savings interest (80TTA)', ruleId: 'DED-80TTA', limit: ttaCap, used: ttaUsed, remaining: Math.max(0, ttaCap - ttaUsed), regimes: ['old'], taxSavedIfFilled: { old: 0, new: 0 } });
  h.push({ key: 'sec80E', label: 'Education-loan interest (80E)', ruleId: 'DED-80E', limit: null, used: d.sec80E, remaining: null, regimes: ['old'], taxSavedIfFilled: { old: 0, new: 0 } });
  if (profile.houseProperty.selfOccupiedInterest > 0 || d.homeLoanPrincipal > 0) {
    const cap = R(oldPack.exemptions.houseProperty.selfOccupiedCap ?? 0);
    h.push({ key: 'hp24b', label: 'Home-loan interest, self-occupied (24(b))', ruleId: 'HP-24B', limit: cap, used: Math.min(cap, profile.houseProperty.selfOccupiedInterest), remaining: Math.max(0, cap - profile.houseProperty.selfOccupiedInterest), regimes: ['old'], taxSavedIfFilled: { old: 0, new: 0 } });
  }

  const schemeAmount = (cap: number) => Math.min(rem80C, cap);
  const sch: Scheme[] = [];
  const add = (s: Omit<Scheme, 'taxBenefit'>, patch: (q: TaxProfile) => void) => sch.push({ ...s, taxBenefit: s.suggestedAmount > 0 ? savedBy(patch) : { old: 0, new: 0 } });
  add({ key: 'ppf', name: 'Public Provident Fund (PPF)', section: '80C', ruleId: 'SCHEMES', eligible: true, eligibilityNote: 'Any resident individual; Rs 500 to Rs 1.5 lakh a year.', lockIn: '15 years (partial withdrawal from year 7)', suggestedAmount: schemeAmount(150000), shownBecause: '80C headroom' }, (q) => { q.deductions.sec80C += schemeAmount(150000); });
  add({ key: 'elss', name: 'ELSS mutual funds', section: '80C', ruleId: 'SCHEMES', eligible: true, eligibilityNote: 'Equity-linked; gains taxed as equity LTCG on exit.', lockIn: '3 years', suggestedAmount: schemeAmount(150000), shownBecause: '80C headroom' }, (q) => { q.deductions.sec80C += schemeAmount(150000); });
  add({ key: 'nps', name: 'NPS Tier-I (own contribution)', section: '80CCD(1B)', ruleId: 'DED-80CCD1B', eligible: true, eligibilityNote: 'Extra Rs 50,000 over 80C. Locked until 60.', lockIn: 'Till age 60', suggestedAmount: rem1B, shownBecause: '80CCD(1B) headroom' }, (q) => { q.deductions.sec80CCD1B += rem1B; });
  add({ key: 'ssy', name: 'Sukanya Samriddhi Yojana', section: '80C', ruleId: 'SCHEMES', eligible: true, eligibilityNote: 'Only for a daughter below 10 years; EEE.', lockIn: 'Till daughter turns 21', suggestedAmount: schemeAmount(150000), shownBecause: '80C headroom' }, (q) => { q.deductions.sec80C += schemeAmount(150000); });
  add({ key: 'scss', name: 'Senior Citizens Savings Scheme', section: '80C', ruleId: 'SCHEMES', eligible: senior, eligibilityNote: senior ? 'Available at 60+.' : 'Only for individuals aged 60+ (consider for parents in the household view).', lockIn: '5 years', suggestedAmount: senior ? schemeAmount(150000) : 0, shownBecause: senior ? '80C headroom' : 'household' }, (q) => { q.deductions.sec80C += schemeAmount(150000); });
  add({ key: 'health', name: 'Health insurance (self + parents)', section: '80D', ruleId: 'DED-80D', eligible: true, eligibilityNote: 'Premium paid by any mode other than cash (check-ups can be cash).', lockIn: 'None', suggestedAmount: remSelf + remPar, shownBecause: '80D headroom' }, (q) => { q.deductions.healthSelf += remSelf; q.deductions.healthParents += remPar; });
  add({ key: 'employerNps', name: 'Employer NPS via salary restructuring', section: '80CCD(2)', ruleId: 'DED-80CCD2', eligible: basicDa > 0, eligibilityNote: 'Needs your employer to offer corporate NPS.', lockIn: 'Till age 60', suggestedAmount: remNps, shownBecause: 'works in both regimes' }, (q) => { q.salary.employerNps += remNps; q.salary.specialAllowance = Math.max(0, q.salary.specialAllowance - remNps); });

  // Only show where the user's regime allows a benefit (plus a plain note otherwise).
  const regime = profile.regime;
  const schemes = sch.filter((s) => s.suggestedAmount > 0 && s.taxBenefit[regime] > 0);
  return {
    regime,
    headroom: h,
    schemes,
    note: regime === 'new'
      ? 'You are on the new regime: 80C, 80D, NPS (1B) and similar investments do not reduce your tax. Only employer NPS does. Headroom values show what they would save in the old regime.'
      : 'Benefits are shown in rupees for the old regime, computed by the engine at your marginal rate.',
  };
}
