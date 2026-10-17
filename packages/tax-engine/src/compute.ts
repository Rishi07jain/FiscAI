import { TaxProfileSchema, type TaxProfile, type TaxProfileInput } from '@fiscai/shared-types';
import { aggregateAndSetOff, classifyTxn, type CGBuckets, type ClassifiedTxn } from './capitalGains';
import { clamp0, mul, roundTo, toPaise, toRupees, type Paise } from './money';
import { getPack, isMetro, type RulePack, type Slab } from './packs';

// ---------------------------------------------------------------------------
// Result types (all amounts in whole rupees)
// ---------------------------------------------------------------------------

export interface TraceStep {
  step: number;
  key: string;
  label: string;
  ruleId?: string;
  input: Record<string, number | string | boolean | null>;
  output: number;
  note?: string;
}

export interface SummaryLine {
  key: string;
  label: string;
  amount: number;
  ruleId?: string;
  explain: string;
  children?: SummaryLine[];
}

export interface SlabBand { from: number; to: number | null; rate: number; income: number; tax: number }

export interface DeductionItem { key: string; label: string; claimed: number; allowed: number; cap: number | null; ruleId: string }

export interface CGTxnResult {
  id?: string;
  label: string;
  assetType: string;
  term: 'short' | 'long';
  bucket: string;
  holdingDays: number;
  gain: number;
  exemptions: { sec54: number; sec54F: number; sec54EC: number };
  indexation?: {
    ciiBuy: number; ciiSell: number; provisional: boolean; indexedCost: number;
    gainIndexed: number; gainUnindexed: number; taxIndexed: number; taxUnindexed: number; chosen: 'indexed' | 'unindexed';
  };
  ruleIds: string[];
  notes: string[];
}

export interface TaxResult {
  packId: string;
  act: string;
  taxYear: string;
  regime: 'new' | 'old';
  income: {
    salary: { gross: number; hraExempt: number; standardDeduction: number; professionalTax: number; net: number; isMetro: boolean };
    houseProperty: { selfOccupied: number; letOut: number; total: number; setOffAllowed: number };
    otherSources: { interest: number; dividends: number; familyPension: number; other: number; total: number };
    business: { nonSpeculative: number; speculative: number; total: number };
    capitalGains: { slabSTCG: number; equitySTCG: number; equityLTCG: number; otherLTCG: number; indexedLTCG: number; promoterBuyback: number; exempted: number; txns: CGTxnResult[] };
    vda: { gains: number; lossesIgnored: number };
  };
  grossTotalIncome: number;
  deductions: { items: DeductionItem[]; total: number };
  normalIncome: number;
  specialIncome: number;
  totalIncome: number;
  basicExemptionAdjusted: number;
  slabTax: number;
  slabs: SlabBand[];
  rebate: number;
  marginalRelief: number;
  specialTax: { equitySTCG: number; equityLTCG: number; equityLTCGExemptionUsed: number; otherLTCG: number; indexedLTCG: number; promoterBuyback: number; vda: number; total: number };
  taxBeforeSurcharge: number;
  surchargeRate: number;
  surcharge: number;
  surchargeRelief: number;
  cess: number;
  totalTax: number;
  prepaid: { tds: number; tcs: number; advanceTax: number; selfAssessment: number; vdaTds: number; total: number };
  balance: number; // > 0 payable, < 0 refund
  effectiveRate: number;
  marginalRate: number;
  carryForward: { stcl: number; ltcl: number; business: number; speculative: number; houseProperty: number };
  lines: SummaryLine[];
  trace: TraceStep[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Slab helpers
// ---------------------------------------------------------------------------

export function slabTax(income: Paise, slabs: Slab[]): { tax: Paise; bands: { from: Paise; to: Paise | null; rate: number; income: Paise; tax: Paise }[] } {
  let prev = 0;
  let tax = 0;
  const bands = [];
  for (const s of slabs) {
    const upper = s.upTo ?? Infinity;
    const inBand = Math.max(0, Math.min(income, upper) - prev);
    const t = mul(inBand, s.rate);
    bands.push({ from: prev, to: s.upTo, rate: s.rate, income: inBand, tax: t });
    tax += t;
    prev = upper;
    if (upper === Infinity) break;
  }
  return { tax, bands };
}

export function basicExemption(slabs: Slab[]): Paise {
  const first = slabs[0];
  return first && first.rate === 0 ? (first.upTo ?? 0) : 0;
}

// ---------------------------------------------------------------------------
// Core tax-on-components (used for main computation and surcharge relief)
// ---------------------------------------------------------------------------

interface Components {
  normal: Paise;
  equitySTCG: Paise;
  equityLTCG: Paise; // before 1.25L exemption
  otherLTCG: Paise;
  indexedLTCG: Paise;
  promoterBuyback: Paise;
  vda: Paise;
}

interface TaxCore {
  slab: ReturnType<typeof slabTax>;
  normal: Paise;
  special: { equitySTCG: Paise; equityLTCGTaxable: Paise; equityLTCGExemptionUsed: Paise; otherLTCG: Paise; indexedLTCG: Paise; promoterBuyback: Paise; vda: Paise };
  specialTax: { equitySTCG: Paise; equityLTCG: Paise; otherLTCG: Paise; indexedLTCG: Paise; promoterBuyback: Paise; vda: Paise };
  basicExemptionAdjusted: Paise;
  rebate: Paise;
  marginalRelief: Paise;
  /** tax after rebate, split into the part eligible for full surcharge and capped (CG) part */
  normalTaxAfterRebate: Paise;
  cgTaxAfterRebate: Paise;
  vdaTaxAfterRebate: Paise;
  total: Paise;
}

function totalOf(c: Components): Paise {
  return c.normal + c.equitySTCG + c.equityLTCG + c.otherLTCG + c.indexedLTCG + c.promoterBuyback + c.vda;
}

function taxCore(c: Components, pack: RulePack, ageBand: keyof RulePack['slabs'], resident: boolean): TaxCore {
  const slabs = pack.slabs[ageBand];
  const sr = pack.specialRates;
  const totalIncome = totalOf(c);

  // 112A exemption first, then basic-exemption shortfall (residents only), highest rate first.
  const ltcgExemptionUsed = Math.min(c.equityLTCG, sr.equityLTCG.exemption);
  const s = {
    equitySTCG: c.equitySTCG,
    equityLTCGTaxable: c.equityLTCG - ltcgExemptionUsed,
    equityLTCGExemptionUsed: ltcgExemptionUsed,
    otherLTCG: c.otherLTCG,
    indexedLTCG: c.indexedLTCG,
    promoterBuyback: c.promoterBuyback,
    vda: c.vda,
  };
  let shortfall = resident ? clamp0(basicExemption(slabs) - c.normal) : 0;
  let adjusted = 0;
  for (const k of ['equitySTCG', 'indexedLTCG', 'otherLTCG', 'equityLTCGTaxable'] as const) {
    const take = Math.min(shortfall, s[k]);
    s[k] -= take;
    shortfall -= take;
    adjusted += take;
  }

  const slab = slabTax(c.normal, slabs);
  const specialTax = {
    equitySTCG: mul(s.equitySTCG, sr.equitySTCG.rate),
    equityLTCG: mul(s.equityLTCGTaxable, sr.equityLTCG.rate),
    otherLTCG: mul(s.otherLTCG, sr.otherLTCG.rate),
    indexedLTCG: mul(s.indexedLTCG, sr.propertyGrandfather.indexedRate),
    promoterBuyback: mul(s.promoterBuyback, sr.promoterBuyback.rate),
    vda: mul(s.vda, sr.vda.rate),
  };

  // Rebate (87A): only for residents with total income within the limit; never on excluded special-rate income.
  const rb = pack.rebate;
  const excluded = new Set(rb.excludes);
  const eligibleSpecial =
    (excluded.has('equitySTCG') ? 0 : specialTax.equitySTCG) +
    (excluded.has('equityLTCG') ? 0 : specialTax.equityLTCG) +
    (excluded.has('otherLTCG') ? 0 : specialTax.otherLTCG + specialTax.indexedLTCG) +
    (excluded.has('vda') ? 0 : specialTax.vda);
  let rebate = 0;
  let marginalRelief = 0;
  const rebateAllowed = !rb.residentOnly || resident;
  if (rebateAllowed && totalIncome <= rb.maxIncome) {
    rebate = Math.min(rb.maxRebate, slab.tax + eligibleSpecial);
  } else if (rebateAllowed && rb.marginalRelief && totalIncome > rb.maxIncome) {
    const excess = totalIncome - rb.maxIncome;
    if (slab.tax > excess) marginalRelief = slab.tax - excess;
  }

  // Allocate the rebate: slab tax first, then eligible special-rate tax.
  const rebateOnSlab = Math.min(rebate, slab.tax);
  const rebateOnCg = rebate - rebateOnSlab;
  const normalTaxAfterRebate = slab.tax - rebateOnSlab - marginalRelief;
  const cgTax = specialTax.equitySTCG + specialTax.equityLTCG + specialTax.otherLTCG + specialTax.indexedLTCG;
  const cgTaxAfterRebate = cgTax - Math.min(rebateOnCg, cgTax);
  const vdaTaxAfterRebate = specialTax.vda - Math.max(0, rebateOnCg - cgTax);
  const total = normalTaxAfterRebate + cgTaxAfterRebate + specialTax.promoterBuyback + vdaTaxAfterRebate;

  return {
    slab,
    normal: c.normal,
    special: s,
    specialTax,
    basicExemptionAdjusted: adjusted,
    rebate,
    marginalRelief,
    normalTaxAfterRebate: normalTaxAfterRebate + specialTax.promoterBuyback,
    cgTaxAfterRebate,
    vdaTaxAfterRebate,
    total,
  };
}

function surchargeRateFor(pack: RulePack, totalIncome: Paise): { rate: number; threshold: Paise } {
  let rate = 0;
  let threshold = 0;
  for (const t of pack.surcharge) {
    if (totalIncome > t.above) {
      rate = t.rate;
      threshold = t.above;
    }
  }
  return { rate, threshold };
}

function surchargeOn(core: TaxCore, rate: number, cap: number): Paise {
  return mul(core.normalTaxAfterRebate + core.vdaTaxAfterRebate, rate) + mul(core.cgTaxAfterRebate, Math.min(rate, cap));
}

/** Reduce components by `amount`, normal income first, then special-rate income. */
function reduceComponents(c: Components, amount: Paise): Components {
  const out = { ...c };
  let left = amount;
  for (const k of ['normal', 'vda', 'promoterBuyback', 'equitySTCG', 'indexedLTCG', 'otherLTCG', 'equityLTCG'] as const) {
    const take = Math.min(out[k], left);
    out[k] -= take;
    left -= take;
  }
  return out;
}

// ---------------------------------------------------------------------------
// computeTax
// ---------------------------------------------------------------------------

export interface ComputeOptions {
  /** internal: skip the marginal-rate probe to avoid recursion */
  skipMarginal?: boolean;
}

export function computeTax(profileInput: TaxProfile | TaxProfileInput, packOrRegime?: RulePack | 'new' | 'old', opts: ComputeOptions = {}): TaxResult {
  const profile = TaxProfileSchema.parse(profileInput);
  const pack = typeof packOrRegime === 'object' ? packOrRegime : getPack(profile.taxYear, packOrRegime ?? profile.regime);
  const isNew = pack.regime === 'new';
  const resident = profile.personal.residency !== 'nri';
  const ageBand = profile.personal.ageBand;
  const trace: TraceStep[] = [];
  const warnings: string[] = [];
  let stepNo = 0;
  const T = (key: string, label: string, output: Paise, input: TraceStep['input'] = {}, ruleId?: string, note?: string) => {
    trace.push({ step: ++stepNo, key, label, ruleId, input, output: toRupees(output), note });
  };
  const R = (p: Paise) => toRupees(p);

  // ---- Step 1: income by head -------------------------------------------
  const sal = profile.salary;
  const basicDa = toPaise(sal.basic) + toPaise(sal.da);
  const grossSalary =
    basicDa + toPaise(sal.hra) + toPaise(sal.specialAllowance) + toPaise(sal.otherAllowances) +
    toPaise(sal.bonus) + toPaise(sal.perquisites) + toPaise(sal.employerNps);
  T('salary.gross', 'Gross salary (incl. employer NPS)', grossSalary, { basic: sal.basic, da: sal.da, hra: sal.hra, special: sal.specialAllowance, other: sal.otherAllowances, bonus: sal.bonus, perquisites: sal.perquisites, employerNps: sal.employerNps });

  // ---- Step 2: exemptions filtered by regime --------------------------------
  const metro = isMetro(pack, profile.personal.city || '');
  let hraExempt = 0;
  if (pack.exemptions.hra && toPaise(sal.hra) > 0 && toPaise(sal.rentPaid) > 0) {
    const a = toPaise(sal.hra);
    const b = clamp0(toPaise(sal.rentPaid) - mul(basicDa, pack.hra.rentExcessPct));
    const c = mul(basicDa, metro ? pack.hra.metroPct : pack.hra.nonMetroPct);
    hraExempt = Math.min(a, b, c);
    T('salary.hraExempt', 'HRA exemption (least of three)', hraExempt, {
      actualHra: R(a), rentMinus10PctSalary: R(b), [`${metro ? 50 : 40}PctOfSalary`]: R(c), city: profile.personal.city, metro,
    }, 'HRA');
  } else if (!pack.exemptions.hra && toPaise(sal.hra) > 0) {
    T('salary.hraExempt', 'HRA exemption not available in the new regime', 0, { hra: sal.hra }, 'REGIME-NEW');
  }
  const stdDed = grossSalary > 0 ? Math.min(pack.standardDeduction, grossSalary - hraExempt) : 0;
  if (grossSalary > 0) T('salary.standardDeduction', 'Standard deduction', stdDed, { limit: R(pack.standardDeduction) }, 'STD-DED');
  const profTax = pack.exemptions.professionalTax ? Math.min(toPaise(sal.professionalTax), pack.professionalTaxCap) : 0;
  if (profTax) T('salary.professionalTax', 'Professional tax', profTax, { paid: sal.professionalTax }, 'PROF-TAX');
  const netSalary = clamp0(grossSalary - hraExempt - stdDed - profTax);
  T('salary.net', 'Income from salary', netSalary, { gross: R(grossSalary), hraExempt: R(hraExempt), standardDeduction: R(stdDed), professionalTax: R(profTax) });

  // House property
  const hp = profile.houseProperty;
  let selfOcc = 0;
  if (toPaise(hp.selfOccupiedInterest) > 0) {
    if (pack.exemptions.houseProperty.selfOccupiedInterest) {
      selfOcc = -Math.min(toPaise(hp.selfOccupiedInterest), pack.exemptions.houseProperty.selfOccupiedCap ?? Infinity);
      T('hp.selfOccupied', 'Self-occupied home-loan interest', selfOcc, { interestPaid: hp.selfOccupiedInterest, cap: R(pack.exemptions.houseProperty.selfOccupiedCap ?? 0) }, 'HP-24B');
    } else {
      T('hp.selfOccupied', 'Self-occupied home-loan interest is not deductible in the new regime', 0, { interestPaid: hp.selfOccupiedInterest }, 'HP-24B');
    }
  }
  let letOut = 0;
  for (const p of hp.letOut) {
    const nav = clamp0(toPaise(p.annualRent) - toPaise(p.municipalTax));
    const inc = nav - mul(nav, 0.3) - toPaise(p.homeLoanInterest);
    letOut += inc;
    T('hp.letOut', `Let-out: ${p.label}`, inc, { rent: p.annualRent, municipalTax: p.municipalTax, standard30Pct: R(mul(nav, 0.3)), interest: p.homeLoanInterest }, 'HP-24B');
  }
  const hpTotal = selfOcc + letOut;
  let hpIncome = hpTotal;
  let hpCarryForward = toPaise(profile.broughtForwardLosses.houseProperty);
  if (hpTotal < 0) {
    if (pack.exemptions.houseProperty.lossSetOffOtherHeads) {
      const cap = pack.exemptions.houseProperty.lossSetOffCap ?? Infinity;
      hpIncome = -Math.min(-hpTotal, cap);
      hpCarryForward += -hpTotal - -hpIncome;
    } else {
      hpIncome = 0;
      warnings.push('House-property loss cannot be set off against other income in the new regime.');
    }
  } else if (hpTotal > 0 && hpCarryForward > 0) {
    const use = Math.min(hpTotal, hpCarryForward);
    hpIncome -= use;
    hpCarryForward -= use;
    T('hp.bfLoss', 'Brought-forward house-property loss set off', -use, {}, 'HP-24B');
  }
  if (hp.letOut.length || selfOcc) T('hp.total', 'Income from house property', hpIncome, { computed: R(hpTotal) }, 'HP-24B');

  // Other sources
  const oi = profile.otherIncome;
  const interest = toPaise(oi.savingsInterest) + toPaise(oi.fdInterest);
  let dividends = toPaise(oi.dividends);
  const fp = toPaise(oi.familyPension);
  const fpDed = Math.min(Math.round(fp * pack.familyPensionDeduction.fraction), pack.familyPensionDeduction.cap);
  const otherMisc = toPaise(oi.other);

  // Capital gains (classify first; deemed-dividend buybacks move to other sources)
  const classified: ClassifiedTxn[] = profile.capitalGains.map((t) => classifyTxn(pack, t, resident));
  for (const c of classified) {
    if (c.deemedDividend) dividends += c.deemedDividend;
    T(`cg.txn`, `Capital gain: ${c.label}`, c.gain, {
      term: c.term, bucket: c.bucket, holdingDays: c.holdingDays, saleValue: R(c.saleValue), cost: R(c.costBasis),
      sec54: R(c.exemptions.sec54), sec54F: R(c.exemptions.sec54F), sec54EC: R(c.exemptions.sec54EC),
      ...(c.indexation ? { indexedTax: R(c.indexation.taxIndexed), unindexedTax: R(c.indexation.taxUnindexed), method: c.indexation.chosen } : {}),
    }, c.ruleIds[0], c.notes.join(' ') || undefined);
  }
  const otherSources = interest + dividends + (fp - fpDed) + otherMisc;
  if (otherSources) T('os.total', 'Income from other sources', otherSources, { interest: R(interest), dividends: R(dividends), familyPension: R(fp - fpDed), other: R(otherMisc) }, dividends ? 'DIV-INT-DED' : undefined);

  // ---- Step 3: loss set-off ------------------------------------------------
  const lossBf = profile.broughtForwardLosses;
  const cg = aggregateAndSetOff(classified, toPaise(lossBf.stcl), toPaise(lossBf.ltcl));
  if (cg.stclUsed || cg.ltclUsed || cg.bfStclUsed || cg.bfLtclUsed) {
    T('cg.setoff', 'Capital losses set off', -(cg.stclUsed + cg.ltclUsed + cg.bfStclUsed + cg.bfLtclUsed), {
      currentSTCL: R(cg.stclUsed), currentLTCL: R(cg.ltclUsed), broughtForwardSTCL: R(cg.bfStclUsed), broughtForwardLTCL: R(cg.bfLtclUsed),
    }, 'CG-LOSS-SETOFF');
  }
  const buckets: CGBuckets = cg.buckets;

  // Business: non-speculative (F&O, other business, presumptive) and speculative (intraday)
  const b = profile.business;
  let nonSpec = toPaise(b.fnoProfit) + toPaise(b.otherBusinessProfit) + toPaise(b.presumptiveIncome);
  let spec = toPaise(b.speculativeProfit);
  let specCf = toPaise(lossBf.speculative);
  let bizCf = toPaise(lossBf.business);
  // brought-forward speculative loss against speculative profit
  if (spec > 0 && specCf > 0) { const u = Math.min(spec, specCf); spec -= u; specCf -= u; }
  if (spec < 0) { specCf += -spec; spec = 0; warnings.push('Speculative (intraday) loss can only be set off against speculative income; carried forward 4 years.'); }
  // current non-speculative loss against speculative profit, then other heads (not salary)
  if (nonSpec < 0 && spec > 0) { const u = Math.min(-nonSpec, spec); nonSpec += u; spec -= u; }
  // brought-forward business loss against business income
  for (const ref of ['nonSpec', 'spec'] as const) {
    if (bizCf <= 0) break;
    if (ref === 'nonSpec' && nonSpec > 0) { const u = Math.min(nonSpec, bizCf); nonSpec -= u; bizCf -= u; }
    if (ref === 'spec' && spec > 0) { const u = Math.min(spec, bizCf); spec -= u; bizCf -= u; }
  }
  let businessLoss = nonSpec < 0 ? -nonSpec : 0;
  if (nonSpec < 0) nonSpec = 0;
  if (b.fnoProfit || b.speculativeProfit || b.otherBusinessProfit || b.presumptiveIncome) {
    T('biz.total', 'Business income (F&O, intraday, other)', nonSpec + spec - businessLoss, {
      fno: b.fnoProfit, speculative: b.speculativeProfit, other: b.otherBusinessProfit, presumptive: b.presumptiveIncome,
    }, 'FNO-BUSINESS');
  }

  // Inter-head set-off: business loss → other sources → slab STCG → special CG → house property (never salary)
  let osIncome = otherSources;
  let hpPos = hpIncome > 0 ? hpIncome : 0;
  const hpNeg = hpIncome < 0 ? -hpIncome : 0;
  if (businessLoss > 0) {
    const before = businessLoss;
    const take = (avail: Paise) => { const u = Math.min(avail, businessLoss); businessLoss -= u; return u; };
    osIncome -= take(osIncome);
    for (const k of ['slabSTCG', 'equitySTCG', 'promoterBuyback', 'indexedLTCG', 'otherLTCG', 'equityLTCG'] as const) buckets[k] -= take(buckets[k]);
    hpPos -= take(hpPos);
    T('biz.setoff', 'Business loss set off against other heads (not salary)', -(before - businessLoss), { remainingCarriedForward: R(businessLoss) }, 'FNO-BUSINESS');
    bizCf += businessLoss;
  }
  // House-property loss (old regime, capped) against any head including salary
  let salaryAfterHp = netSalary;
  if (hpNeg > 0) {
    let left = hpNeg;
    const take = (avail: Paise) => { const u = Math.min(avail, left); left -= u; return u; };
    salaryAfterHp -= take(salaryAfterHp);
    osIncome -= take(osIncome);
    nonSpec -= take(nonSpec);
    for (const k of ['slabSTCG', 'equitySTCG', 'indexedLTCG', 'otherLTCG', 'equityLTCG'] as const) buckets[k] -= take(buckets[k]);
    hpCarryForward += left;
    T('hp.setoff', 'House-property loss set off against other heads', -(hpNeg - left), { cap: R(pack.exemptions.houseProperty.lossSetOffCap ?? 0) }, 'HP-24B');
  }

  // VDA: flat rate, no loss set-off
  let vdaGains = 0;
  let vdaLosses = 0;
  let vdaTds = 0;
  for (const v of profile.vda) {
    const g = toPaise(v.saleValue) - toPaise(v.cost);
    if (g >= 0) vdaGains += g; else vdaLosses += -g;
    vdaTds += toPaise(v.tdsDeducted);
  }
  if (profile.vda.length) T('vda', 'Crypto / VDA gains (losses ignored)', vdaGains, { lossesIgnored: R(vdaLosses), tds: R(vdaTds) }, 'VDA-30');
  if (vdaLosses) warnings.push('Crypto losses cannot be set off against any income or carried forward.');

  // ---- Step 4: deductions (Chapter VI-A) ------------------------------------
  const normalBeforeDeductions = salaryAfterHp + hpPos + osIncome + nonSpec + spec + buckets.slabSTCG;
  const gti = normalBeforeDeductions + buckets.equitySTCG + buckets.equityLTCG + buckets.otherLTCG + buckets.indexedLTCG + buckets.promoterBuyback + vdaGains;
  T('gti', 'Gross total income', gti, {});

  const d = profile.deductions;
  const items: DeductionItem[] = [];
  const ded = pack.deductions;
  const allowed = new Set(ded.allowed);
  const add = (key: string, label: string, claimed: Paise, cap: Paise | null, ruleId: string, allowKey = key) => {
    if (claimed <= 0) return;
    const ok = allowed.has(allowKey);
    const amt = ok ? (cap === null ? claimed : Math.min(claimed, cap)) : 0;
    items.push({ key, label, claimed: R(claimed), allowed: R(amt), cap: cap === null ? null : R(cap), ruleId });
  };
  const npsCap = mul(basicDa, ded.employerNps.pctOfBasicDa);
  add('employerNps', 'Employer NPS contribution', toPaise(sal.employerNps), npsCap, 'DED-80CCD2');
  const senior = ageBand !== 'below60';
  if (isNew) {
    const ignored = toPaise(d.sec80C) + toPaise(d.homeLoanPrincipal) + toPaise(d.sec80CCD1B) + toPaise(d.healthSelf) + toPaise(d.healthParents) + toPaise(d.sec80E) + toPaise(d.sec80G);
    if (ignored > 0) {
      items.push({ key: 'notAllowed', label: '80C, 80D, 80E, 80G and similar (not allowed in the new regime)', claimed: R(ignored), allowed: 0, cap: 0, ruleId: 'REGIME-NEW' });
    }
  } else {
    add('sec80C', '80C investments + home-loan principal', toPaise(d.sec80C) + toPaise(d.homeLoanPrincipal), ded.sec80C.cap, 'DED-80C');
    add('sec80CCD1B', 'Own NPS (80CCD(1B))', toPaise(d.sec80CCD1B), ded.sec80CCD1B.cap, 'DED-80CCD1B');
    const d80 = ded.sec80D;
    const selfCap = senior ? d80.selfSenior : d80.self;
    add('sec80D', 'Health insurance – self & family', toPaise(d.healthSelf) + Math.min(toPaise(d.preventiveCheckup), d80.preventive), selfCap, 'DED-80D');
    add('sec80DParents', 'Health insurance – parents', toPaise(d.healthParents), profile.personal.parentsSenior ? d80.parentsSenior : d80.parents, 'DED-80D', 'sec80D');
    add('sec80E', 'Education-loan interest (80E)', toPaise(d.sec80E), null, 'DED-80E');
    add('sec80G', 'Donations (80G)', toPaise(d.sec80G), null, 'DED-80G');
    if (senior) add('sec80TTB', 'Interest income – seniors (80TTB)', interest, ded.sec80TTB.cap, 'DED-80TTA');
    else add('sec80TTA', 'Savings interest (80TTA)', toPaise(oi.savingsInterest), ded.sec80TTA.cap, 'DED-80TTA');
  }
  let dedTotal = items.reduce((s, i) => s + toPaise(i.allowed), 0);
  if (dedTotal > normalBeforeDeductions) {
    warnings.push('Deductions are capped at income other than special-rate capital gains and VDA.');
    dedTotal = normalBeforeDeductions;
  }
  T('deductions', 'Deductions allowed in this regime', -dedTotal, Object.fromEntries(items.map((i) => [i.key, i.allowed])));

  // ---- Step 5: split normal vs special-rate income ---------------------------
  const normalRaw = clamp0(normalBeforeDeductions - dedTotal);
  const normal = roundTo(normalRaw, pack.rounding.totalIncomeTo);
  const comps: Components = {
    normal,
    equitySTCG: buckets.equitySTCG,
    equityLTCG: buckets.equityLTCG,
    otherLTCG: buckets.otherLTCG,
    indexedLTCG: buckets.indexedLTCG,
    promoterBuyback: buckets.promoterBuyback,
    vda: vdaGains,
  };
  const totalIncome = totalOf(comps);
  const specialIncome = totalIncome - normal;
  T('totalIncome', 'Total income (rounded to Rs 10)', totalIncome, { normalIncome: R(normal), specialRateIncome: R(specialIncome) });

  // ---- Steps 6-7: slab tax, rebate, marginal relief, special-rate tax -------
  const core = taxCore(comps, pack, ageBand, resident);
  T('slabTax', 'Tax on normal income at slab rates', core.slab.tax, { normalIncome: R(normal), ageBand }, isNew ? 'REGIME-NEW' : 'REGIME-OLD');
  if (core.basicExemptionAdjusted) T('basicExemptionShortfall', 'Unused basic exemption adjusted against capital gains', -core.basicExemptionAdjusted, {}, 'CG-EQ-STCG');
  if (core.rebate) T('rebate', 'Rebate for residents', -core.rebate, { totalIncome: R(totalIncome), limit: R(pack.rebate.maxIncome), maxRebate: R(pack.rebate.maxRebate) }, 'REBATE-87A');
  else if (totalIncome > pack.rebate.maxIncome && totalIncome - pack.rebate.maxIncome < toPaise(100000) && resident) {
    T('rebate', 'No rebate: total income exceeds the limit', 0, { totalIncome: R(totalIncome), limit: R(pack.rebate.maxIncome) }, 'REBATE-87A');
  }
  if (core.marginalRelief) T('marginalRelief', 'Marginal relief on rebate', -core.marginalRelief, { incomeAboveLimit: R(totalIncome - pack.rebate.maxIncome) }, 'REBATE-87A');
  const st = core.specialTax;
  if (comps.equitySTCG) T('tax.equitySTCG', 'Equity STCG at 20%', st.equitySTCG, { gains: R(core.special.equitySTCG) }, 'CG-EQ-STCG');
  if (comps.equityLTCG) T('tax.equityLTCG', 'Equity LTCG at 12.5% above Rs 1.25 lakh', st.equityLTCG, { gains: R(comps.equityLTCG), exemptionUsed: R(core.special.equityLTCGExemptionUsed), taxable: R(core.special.equityLTCGTaxable) }, 'CG-EQ-LTCG');
  if (comps.otherLTCG) T('tax.otherLTCG', 'Other LTCG at 12.5%', st.otherLTCG, { gains: R(core.special.otherLTCG) }, 'CG-OTHER-LTCG');
  if (comps.indexedLTCG) T('tax.indexedLTCG', 'Property LTCG at 20% with indexation', st.indexedLTCG, { gains: R(core.special.indexedLTCG) }, 'CG-PROP-INDEX');
  if (comps.promoterBuyback) T('tax.promoterBuyback', 'Promoter buyback gains', st.promoterBuyback, { gains: R(comps.promoterBuyback) }, 'CG-BUYBACK');
  if (comps.vda) T('tax.vda', 'VDA at 30%', st.vda, { gains: R(comps.vda) }, 'VDA-30');

  // ---- Step 8: surcharge (with marginal relief) and cess ---------------------
  const { rate: sRate, threshold } = surchargeRateFor(pack, totalIncome);
  const cap = pack.specialRates.specialSurchargeCap;
  let surcharge = sRate ? surchargeOn(core, sRate, cap) : 0;
  let surchargeRelief = 0;
  if (sRate) {
    const atT = reduceComponents(comps, totalIncome - threshold);
    const coreT = taxCore(atT, pack, ageBand, resident);
    const { rate: rateT } = surchargeRateFor(pack, threshold);
    const limit = coreT.total + (rateT ? surchargeOn(coreT, rateT, cap) : 0) + (totalIncome - threshold);
    const actual = core.total + surcharge;
    if (actual > limit) {
      surchargeRelief = actual - limit;
      surcharge -= surchargeRelief;
    }
    T('surcharge', `Surcharge at ${Math.round(sRate * 100)}%`, surcharge, { rate: sRate, specialRateCap: cap, marginalRelief: R(surchargeRelief) }, 'SURCHARGE');
  }
  const cess = mul(core.total + surcharge, pack.cess);
  T('cess', 'Health & education cess at 4%', cess, { on: R(core.total + surcharge) }, 'SURCHARGE');
  const totalTax = roundTo(core.total + surcharge + cess, pack.rounding.taxTo);
  T('totalTax', 'Total tax liability (rounded to Rs 10)', totalTax, {});

  // ---- Step 9: prepaid taxes ---------------------------------------------------
  const tp = profile.taxesPaid;
  const advPaid = toPaise(tp.advanceTax) + tp.advancePayments.reduce((s, p) => s + toPaise(p.amount), 0);
  const prepaid = { tds: toPaise(tp.tds), tcs: toPaise(tp.tcs), advanceTax: advPaid, selfAssessment: toPaise(tp.selfAssessment), vdaTds };
  const prepaidTotal = prepaid.tds + prepaid.tcs + prepaid.advanceTax + prepaid.selfAssessment + prepaid.vdaTds;
  const balance = totalTax - prepaidTotal;
  T('balance', balance >= 0 ? 'Balance tax payable' : 'Refund due', balance, { tds: R(prepaid.tds), tcs: R(prepaid.tcs), advanceTax: R(prepaid.advanceTax), selfAssessment: R(prepaid.selfAssessment), vdaTds: R(vdaTds) });

  // Effective and marginal rates
  const grossIncome = grossSalary + Math.max(0, hpTotal) + otherSources + Math.max(0, toPaise(b.fnoProfit)) + Math.max(0, toPaise(b.speculativeProfit)) + gtiPositiveCg(classified) + vdaGains;
  const effectiveRate = grossIncome > 0 ? totalTax / grossIncome : 0;
  let marginalRate = 0;
  if (!opts.skipMarginal) {
    const bumped = TaxProfileSchema.parse({ ...profile, otherIncome: { ...profile.otherIncome, other: profile.otherIncome.other + 10000 } });
    const t2 = computeTax(bumped, pack, { skipMarginal: true });
    marginalRate = Math.max(0, (t2.totalTax - R(totalTax)) / 10000);
  }

  if (profile.personal.residency === 'nri') warnings.push('NRI-specific rules (DTAA, foreign assets) are outside FiscAI v2 scope.');
  for (const c of classified) if (c.indexation?.provisional) { warnings.push('Cost Inflation Index for the sale year is provisional.'); break; }

  const exempted = classified.reduce((s, c) => s + c.exemptions.sec54 + c.exemptions.sec54F + c.exemptions.sec54EC, 0);
  const cgBlock = {
    slabSTCG: R(buckets.slabSTCG), equitySTCG: R(buckets.equitySTCG), equityLTCG: R(buckets.equityLTCG), otherLTCG: R(buckets.otherLTCG),
    indexedLTCG: R(buckets.indexedLTCG), promoterBuyback: R(buckets.promoterBuyback), exempted: R(exempted),
    txns: classified.map<CGTxnResult>((c) => ({
      id: c.id, label: c.label, assetType: c.assetType, term: c.term, bucket: c.bucket, holdingDays: c.holdingDays, gain: R(c.gain),
      exemptions: { sec54: R(c.exemptions.sec54), sec54F: R(c.exemptions.sec54F), sec54EC: R(c.exemptions.sec54EC) },
      indexation: c.indexation && {
        ciiBuy: c.indexation.ciiBuy, ciiSell: c.indexation.ciiSell, provisional: c.indexation.provisional, indexedCost: R(c.indexation.indexedCost),
        gainIndexed: R(c.indexation.gainIndexed), gainUnindexed: R(c.indexation.gainUnindexed), taxIndexed: R(c.indexation.taxIndexed),
        taxUnindexed: R(c.indexation.taxUnindexed), chosen: c.indexation.chosen,
      },
      ruleIds: c.ruleIds, notes: c.notes,
    })),
  };

  const specialTaxTotal = st.equitySTCG + st.equityLTCG + st.otherLTCG + st.indexedLTCG + st.promoterBuyback + st.vda;
  const result: TaxResult = {
    packId: pack.id,
    act: pack.act,
    taxYear: pack.taxYear,
    regime: pack.regime,
    income: {
      salary: { gross: R(grossSalary), hraExempt: R(hraExempt), standardDeduction: R(stdDed), professionalTax: R(profTax), net: R(netSalary), isMetro: metro },
      houseProperty: { selfOccupied: R(selfOcc), letOut: R(letOut), total: R(hpTotal), setOffAllowed: R(hpIncome) },
      otherSources: { interest: R(interest), dividends: R(dividends), familyPension: R(fp - fpDed), other: R(otherMisc), total: R(otherSources) },
      business: { nonSpeculative: R(nonSpec), speculative: R(spec), total: R(nonSpec + spec) },
      capitalGains: cgBlock,
      vda: { gains: R(vdaGains), lossesIgnored: R(vdaLosses) },
    },
    grossTotalIncome: R(gti),
    deductions: { items, total: R(dedTotal) },
    normalIncome: R(normal),
    specialIncome: R(specialIncome),
    totalIncome: R(totalIncome),
    basicExemptionAdjusted: R(core.basicExemptionAdjusted),
    slabTax: R(core.slab.tax),
    slabs: core.slab.bands.map((x) => ({ from: R(x.from), to: x.to === null ? null : R(x.to), rate: x.rate, income: R(x.income), tax: R(x.tax) })),
    rebate: R(core.rebate),
    marginalRelief: R(core.marginalRelief),
    specialTax: {
      equitySTCG: R(st.equitySTCG), equityLTCG: R(st.equityLTCG), equityLTCGExemptionUsed: R(core.special.equityLTCGExemptionUsed),
      otherLTCG: R(st.otherLTCG), indexedLTCG: R(st.indexedLTCG), promoterBuyback: R(st.promoterBuyback), vda: R(st.vda), total: R(specialTaxTotal),
    },
    taxBeforeSurcharge: R(core.total),
    surchargeRate: sRate,
    surcharge: R(surcharge),
    surchargeRelief: R(surchargeRelief),
    cess: R(cess),
    totalTax: R(totalTax),
    prepaid: { tds: R(prepaid.tds), tcs: R(prepaid.tcs), advanceTax: R(prepaid.advanceTax), selfAssessment: R(prepaid.selfAssessment), vdaTds: R(vdaTds), total: R(prepaidTotal) },
    balance: R(balance),
    effectiveRate,
    marginalRate,
    carryForward: { stcl: R(cg.stclCarryForward), ltcl: R(cg.ltclCarryForward), business: R(bizCf), speculative: R(specCf), houseProperty: R(hpCarryForward) },
    lines: [],
    trace,
    warnings,
  };
  result.lines = buildLines(result, pack);
  return result;
}

function gtiPositiveCg(txns: ClassifiedTxn[]): Paise {
  return txns.reduce((s, t) => s + (t.bucket !== 'exempt' && t.gain > 0 ? t.gain : 0), 0);
}

const fmt = (n: number) => `Rs ${n.toLocaleString('en-IN')}`;

function buildLines(r: TaxResult, pack: RulePack): SummaryLine[] {
  const s = r.income.salary;
  const cg = r.income.capitalGains;
  const lines: SummaryLine[] = [];
  lines.push({
    key: 'salary', label: 'Income from salary', amount: s.net, ruleId: 'STD-DED',
    explain: `Gross ${fmt(s.gross)} − HRA exemption ${fmt(s.hraExempt)} − standard deduction ${fmt(s.standardDeduction)}${s.professionalTax ? ` − professional tax ${fmt(s.professionalTax)}` : ''} = ${fmt(s.net)}.`,
    children: [
      { key: 'salary.gross', label: 'Gross salary', amount: s.gross, explain: 'Basic, DA, HRA, allowances, bonus, perquisites and employer NPS.' },
      { key: 'salary.hra', label: 'HRA exemption', amount: -s.hraExempt, ruleId: 'HRA', explain: r.regime === 'new' ? 'Not available in the new regime.' : `Least of actual HRA, rent − 10% of basic+DA, and ${s.isMetro ? '50% (metro)' : '40% (non-metro)'} of basic+DA.` },
      { key: 'salary.std', label: 'Standard deduction', amount: -s.standardDeduction, ruleId: 'STD-DED', explain: `${fmt(pack.standardDeduction / 100)} flat in the ${r.regime} regime.` },
    ],
  });
  if (r.income.houseProperty.total) lines.push({ key: 'hp', label: 'House property', amount: r.income.houseProperty.setOffAllowed, ruleId: 'HP-24B', explain: `Computed ${fmt(r.income.houseProperty.total)}; allowed against income: ${fmt(r.income.houseProperty.setOffAllowed)}.` });
  if (r.income.otherSources.total) lines.push({ key: 'os', label: 'Other sources', amount: r.income.otherSources.total, explain: `Interest ${fmt(r.income.otherSources.interest)}, dividends ${fmt(r.income.otherSources.dividends)}, other ${fmt(r.income.otherSources.other + r.income.otherSources.familyPension)}. Taxed at slab rates.` });
  if (r.income.business.total) lines.push({ key: 'biz', label: 'Business / F&O', amount: r.income.business.total, ruleId: 'FNO-BUSINESS', explain: 'F&O is non-speculative business income at slab rates; intraday is speculative.' });
  const cgTotal = cg.slabSTCG + cg.equitySTCG + cg.equityLTCG + cg.otherLTCG + cg.indexedLTCG + cg.promoterBuyback;
  if (cgTotal || cg.txns.length) lines.push({
    key: 'cg', label: 'Capital gains (after set-off)', amount: cgTotal, ruleId: 'CG-LOSS-SETOFF',
    explain: `${cg.txns.length} transaction(s). Short-term losses offset any gains; long-term losses only long-term gains.${cg.exempted ? ` ${fmt(cg.exempted)} exempt via reinvestment.` : ''}`,
    children: [
      { key: 'cg.slab', label: 'STCG at slab rate', amount: cg.slabSTCG, ruleId: 'CG-OTHER-LTCG', explain: 'Short-term gains on non-equity assets and debt MFs.' },
      { key: 'cg.eqst', label: 'Equity STCG (20%)', amount: cg.equitySTCG, ruleId: 'CG-EQ-STCG', explain: 'Listed equity / equity MFs held ≤ 12 months.' },
      { key: 'cg.eqlt', label: 'Equity LTCG (12.5% above Rs 1.25 lakh)', amount: cg.equityLTCG, ruleId: 'CG-EQ-LTCG', explain: `Exemption used: ${fmt(r.specialTax.equityLTCGExemptionUsed)}.` },
      { key: 'cg.olt', label: 'Other LTCG (12.5%)', amount: cg.otherLTCG, ruleId: 'CG-OTHER-LTCG', explain: 'Property, gold, unlisted shares held long-term, without indexation.' },
      { key: 'cg.idx', label: 'Property LTCG with indexation (20%)', amount: cg.indexedLTCG, ruleId: 'CG-PROP-INDEX', explain: 'Chosen where cheaper for property bought before 23 Jul 2024.' },
    ].filter((c) => c.amount),
  });
  if (r.income.vda.gains) lines.push({ key: 'vda', label: 'Crypto / VDA gains', amount: r.income.vda.gains, ruleId: 'VDA-30', explain: `Flat 30%. Losses ignored: ${fmt(r.income.vda.lossesIgnored)}.` });
  lines.push({ key: 'gti', label: 'Gross total income', amount: r.grossTotalIncome, explain: 'Sum of all heads after loss set-off.' });
  lines.push({
    key: 'ded', label: 'Deductions', amount: -r.deductions.total, ruleId: r.regime === 'new' ? 'DED-80CCD2' : 'DED-80C',
    explain: r.regime === 'new' ? 'Only employer NPS (80CCD(2)) is allowed in the new regime.' : 'Chapter VI-A deductions, each capped at its limit.',
    children: r.deductions.items.map((i) => ({ key: `ded.${i.key}`, label: i.label, amount: -i.allowed, ruleId: i.ruleId, explain: `Claimed ${fmt(i.claimed)}${i.cap !== null ? `, cap ${fmt(i.cap)}` : ', no cap'}; allowed ${fmt(i.allowed)}.` })),
  });
  lines.push({ key: 'ti', label: 'Total taxable income', amount: r.totalIncome, explain: `Normal income ${fmt(r.normalIncome)} + special-rate income ${fmt(r.specialIncome)}, rounded to the nearest Rs 10.` });
  lines.push({
    key: 'slab', label: 'Tax at slab rates', amount: r.slabTax, ruleId: r.regime === 'new' ? 'REGIME-NEW' : 'REGIME-OLD',
    explain: r.slabs.filter((b) => b.income > 0).map((b) => `${fmt(b.income)} × ${Math.round(b.rate * 100)}% = ${fmt(b.tax)}`).join('; ') || 'No income in taxable slabs.',
  });
  if (r.specialTax.total) lines.push({ key: 'special', label: 'Special-rate tax', amount: r.specialTax.total, ruleId: 'CG-EQ-LTCG', explain: `Equity STCG ${fmt(r.specialTax.equitySTCG)}, equity LTCG ${fmt(r.specialTax.equityLTCG)}, other LTCG ${fmt(r.specialTax.otherLTCG + r.specialTax.indexedLTCG)}, VDA ${fmt(r.specialTax.vda)}.` });
  if (r.rebate || r.marginalRelief) lines.push({ key: 'rebate', label: r.rebate ? 'Rebate' : 'Marginal relief', amount: -(r.rebate + r.marginalRelief), ruleId: 'REBATE-87A', explain: r.rebate ? `Total income ≤ ${fmt(pack.rebate.maxIncome / 100)}: rebate up to ${fmt(pack.rebate.maxRebate / 100)} (not on special-rate income).` : `Tax on normal income limited to the income above ${fmt(pack.rebate.maxIncome / 100)}.` });
  if (r.surcharge) lines.push({ key: 'surcharge', label: `Surcharge (${Math.round(r.surchargeRate * 100)}%)`, amount: r.surcharge, ruleId: 'SURCHARGE', explain: `Capped at 15% on capital gains.${r.surchargeRelief ? ` Marginal relief ${fmt(r.surchargeRelief)}.` : ''}` });
  lines.push({ key: 'cess', label: 'Cess (4%)', amount: r.cess, ruleId: 'SURCHARGE', explain: '4% on tax plus surcharge.' });
  lines.push({ key: 'total', label: 'Total tax', amount: r.totalTax, explain: 'Rounded to the nearest Rs 10.' });
  lines.push({ key: 'prepaid', label: 'TDS, TCS & advance tax paid', amount: -r.prepaid.total, ruleId: 'ADV-TAX', explain: `TDS ${fmt(r.prepaid.tds)}, TCS ${fmt(r.prepaid.tcs)}, advance ${fmt(r.prepaid.advanceTax)}, self-assessment ${fmt(r.prepaid.selfAssessment)}, VDA TDS ${fmt(r.prepaid.vdaTds)}.` });
  lines.push({ key: 'balance', label: r.balance >= 0 ? 'Balance payable' : 'Refund due', amount: r.balance, explain: r.balance >= 0 ? 'Pay as advance or self-assessment tax.' : 'Claimed when you file your return.' });
  return lines;
}

