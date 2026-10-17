import {
  ScenarioInputSchemas, TaxProfileSchema, type CapitalGainTxn, type ScenarioType, type TaxProfile, type TaxProfileInput,
} from '@fiscai/shared-types';
import { CapitalGainTxnSchema } from '@fiscai/shared-types';
import { computeTax, type TaxResult } from './compute';
import { addMonths, daysBetween, isLongTerm, longTermFrom, returnDateFor, taxYearOf } from './dates';
import { getPack } from './packs';

export interface ScenarioInsight { kind: 'info' | 'saving' | 'warning' | 'deadline'; text: string; ruleId?: string; amount?: number }
export interface ScenarioDeadline { type: string; title: string; dueDate: string; ruleId: string }

export interface ScenarioResult {
  type: ScenarioType;
  taxYear: string;
  regime: 'new' | 'old';
  before: { new: number; old: number; chosen: number };
  after: { new: number; old: number; chosen: number };
  delta: number; // after - before in the user's chosen regime
  bestRegimeAfter: 'new' | 'old';
  beforeResult: TaxResult;
  afterResult: TaxResult;
  ruleIds: string[];
  insights: ScenarioInsight[];
  deadlines: ScenarioDeadline[];
  details: Record<string, unknown>;
  /** The profile that "apply" would save. */
  afterProfile: TaxProfile;
}

const clone = <T>(x: T): T => structuredClone(x);
const inr = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;

function finish(
  type: ScenarioType, before: TaxProfile, after: TaxProfile, extra: Partial<Pick<ScenarioResult, 'insights' | 'deadlines' | 'details' | 'ruleIds'>> = {},
): ScenarioResult {
  const bN = computeTax(before, 'new');
  const bO = computeTax(before, 'old');
  const aN = computeTax(after, 'new');
  const aO = computeTax(after, 'old');
  const chosenB = before.regime === 'new' ? bN : bO;
  const chosenA = after.regime === 'new' ? aN : aO;
  const ruleIds = new Set(extra.ruleIds ?? []);
  for (const t of chosenA.trace) if (t.ruleId && !chosenB.trace.some((x) => x.key === t.key && x.output === t.output)) ruleIds.add(t.ruleId);
  return {
    type,
    taxYear: before.taxYear,
    regime: after.regime,
    before: { new: bN.totalTax, old: bO.totalTax, chosen: chosenB.totalTax },
    after: { new: aN.totalTax, old: aO.totalTax, chosen: chosenA.totalTax },
    delta: chosenA.totalTax - chosenB.totalTax,
    bestRegimeAfter: aO.totalTax < aN.totalTax ? 'old' : 'new',
    beforeResult: chosenB,
    afterResult: chosenA,
    ruleIds: [...ruleIds],
    insights: extra.insights ?? [],
    deadlines: extra.deadlines ?? [],
    details: extra.details ?? {},
    afterProfile: after,
  };
}

// ---------------------------------------------------------------------------

export interface SellPiece { qty: number; buyDate: string; buyPrice: number; longTerm: boolean; gain: number; longTermOn: string }

/** FIFO-match a sale quantity against lots (oldest first). */
export function fifoMatch(lots: { qty: number; buyDate: string; buyPrice: number }[], qty: number, price: number, date: string, months = 12): SellPiece[] {
  const sorted = [...lots].sort((a, b) => a.buyDate.localeCompare(b.buyDate));
  const out: SellPiece[] = [];
  let left = qty;
  for (const l of sorted) {
    if (left <= 0) break;
    const q = Math.min(l.qty, left);
    left -= q;
    out.push({ qty: q, buyDate: l.buyDate, buyPrice: l.buyPrice, longTerm: isLongTerm(l.buyDate, date, months), gain: Math.round(q * (price - l.buyPrice)), longTermOn: longTermFrom(l.buyDate, months) });
  }
  if (left > 1e-9) throw new Error(`Only ${qty - left} units available to sell`);
  return out;
}

function equityTxns(symbol: string, assetType: 'listed_equity' | 'equity_mf', pieces: SellPiece[], price: number, date: string, charges: number, totalQty: number): CapitalGainTxn[] {
  return pieces.map((p, i) =>
    CapitalGainTxnSchema.parse({
      id: `scn-${i}`,
      label: `${symbol || 'Equity'} × ${p.qty} (bought ${p.buyDate})`,
      assetType, buyDate: p.buyDate, sellDate: date,
      cost: Math.round(p.qty * p.buyPrice), saleValue: Math.round(p.qty * price),
      expenses: Math.round((charges * p.qty) / totalQty), sttPaid: true,
    }),
  );
}

function sellEquity(profile: TaxProfile, raw: unknown): ScenarioResult {
  const i = ScenarioInputSchemas.sell_equity.parse(raw);
  const pieces = fifoMatch(i.lots, i.qty, i.price, i.date);
  const after = clone(profile);
  after.capitalGains.push(...equityTxns(i.symbol, i.assetType, pieces, i.price, i.date, i.charges, i.qty));
  const res = finish('sell_equity', profile, after, { ruleIds: ['CG-EQ-STCG', 'CG-EQ-LTCG'] });
  const st = pieces.filter((p) => !p.longTerm);
  const lt = pieces.filter((p) => p.longTerm);
  const stGain = st.reduce((s, p) => s + p.gain, 0);
  const ltGain = lt.reduce((s, p) => s + p.gain, 0);
  const r = res.afterResult;
  res.insights.push({ kind: 'info', text: `Short-term gain ${inr(stGain)} (20%), long-term gain ${inr(ltGain)} (12.5% above Rs 1.25 lakh).`, ruleId: 'CG-EQ-STCG' });
  res.insights.push({ kind: 'info', text: `Rs 1.25 lakh LTCG exemption used this year: ${inr(r.specialTax.equityLTCGExemptionUsed)} (${inr(Math.max(0, 125000 - r.specialTax.equityLTCGExemptionUsed))} left).`, ruleId: 'CG-EQ-LTCG' });

  // "Wait N days" nudge: if short-term pieces have gains, compare selling once all turn long-term.
  const stWithGain = st.filter((p) => p.gain > 0);
  if (stWithGain.length) {
    const waitUntil = stWithGain.map((p) => p.longTermOn).sort().at(-1)!;
    const days = daysBetween(i.date, waitUntil);
    const sameYear = taxYearOf(waitUntil) === profile.taxYear;
    const later = clone(profile);
    later.capitalGains.push(...equityTxns(i.symbol, i.assetType, fifoMatch(i.lots, i.qty, i.price, waitUntil), i.price, waitUntil, i.charges, i.qty));
    const laterTax = computeTax(later, profile.regime, { skipMarginal: true }).totalTax;
    const saving = r.totalTax - laterTax;
    const qtyST = stWithGain.reduce((s, p) => s + p.qty, 0);
    if (saving > 0) {
      res.insights.push({ kind: 'saving', amount: saving, ruleId: 'CG-EQ-LTCG', text: `These ${qtyST} units turn long-term in ${days} days (${waitUntil}); waiting saves about ${inr(saving)} at the same price.${sameYear ? '' : ' Note: that date falls in the next Tax Year, so the gain moves to next year’s return.'}` });
    }
    res.details.wait = { until: waitUntil, days, saving, sameTaxYear: sameYear, qty: qtyST };
  }
  res.details.pieces = pieces;
  return res;
}

function sellProperty(profile: TaxProfile, raw: unknown): ScenarioResult {
  const i = ScenarioInputSchemas.sell_property.parse(raw);
  const txn = CapitalGainTxnSchema.parse({
    id: 'scn-prop', label: i.label, assetType: i.assetType, buyDate: i.buyDate, sellDate: i.saleDate,
    cost: i.cost, saleValue: i.salePrice, expenses: i.expenses, improvements: i.improvements,
    isResidentialHouse: i.isResidentialHouse, reinvest: i.reinvest,
  });
  const after = clone(profile);
  after.capitalGains.push(txn);
  // Also compute without any reinvestment to show the value of each exemption.
  const noReinvest = clone(profile);
  noReinvest.capitalGains.push({ ...txn, reinvest: { sec54: 0, sec54F: 0, sec54EC: 0 } });
  const taxNoReinvest = computeTax(noReinvest, profile.regime, { skipMarginal: true }).totalTax;
  const res = finish('sell_property', profile, after, { ruleIds: ['CG-OTHER-LTCG'] });
  const cgt = res.afterResult.income.capitalGains.txns.find((t) => t.id === 'scn-prop');
  if (cgt?.indexation) {
    const x = cgt.indexation;
    res.insights.push({ kind: 'info', ruleId: 'CG-PROP-INDEX', text: `Bought before 23 Jul 2024, so both options apply: 12.5% without indexation → tax ${inr(x.taxUnindexed)} on gain ${inr(x.gainUnindexed)}; 20% with indexation (CII ${x.ciiBuy} → ${x.ciiSell}${x.provisional ? ', provisional' : ''}) → tax ${inr(x.taxIndexed)} on gain ${inr(x.gainIndexed)}. FiscAI picks the ${x.chosen === 'indexed' ? 'indexed' : 'unindexed'} option.` });
  }
  if (cgt && cgt.term === 'short') res.insights.push({ kind: 'warning', text: 'Held 24 months or less: the gain is short-term and taxed at your slab rate. No 54/54EC exemption.', ruleId: 'CG-OTHER-LTCG' });
  const reinvestSaving = taxNoReinvest - res.after.chosen;
  if (reinvestSaving > 0) res.insights.push({ kind: 'saving', amount: reinvestSaving, text: `Reinvestment exemptions save ${inr(reinvestSaving)}.`, ruleId: 'CG-54EC' });
  else if (cgt?.term === 'long') res.insights.push({ kind: 'info', text: `Investing up to Rs 50 lakh in 54EC bonds within 6 months, or buying a house (Sec 54/54F), can cut this tax of ${inr(taxNoReinvest - res.before.chosen)}.`, ruleId: 'CG-54EC' });

  const due = returnDateFor(taxYearOf(i.saleDate), getPack(profile.taxYear, 'new').returnDueDates['ITR-2']);
  if (cgt?.term === 'long') {
    res.deadlines.push({ type: 'sec54EC', title: 'Buy 54EC bonds (NHAI/REC/PFC/IRFC)', dueDate: addMonths(i.saleDate, 6), ruleId: 'CG-54EC' });
    res.deadlines.push({ type: 'cgas', title: 'Deposit unused gains in Capital Gains Account Scheme', dueDate: due, ruleId: 'CGAS' });
    res.deadlines.push({ type: 'sec54_purchase', title: 'Buy the new house (Sec 54/54F window)', dueDate: addMonths(i.saleDate, 24), ruleId: 'CG-54' });
    res.deadlines.push({ type: 'sec54_construct', title: 'Finish constructing the new house', dueDate: addMonths(i.saleDate, 36), ruleId: 'CG-54' });
  }
  res.details.taxWithoutReinvestment = taxNoReinvest;
  return res;
}

export function amortize(loan: number, ratePct: number, tenureYears: number, months: number) {
  const r = ratePct / 1200;
  const n = tenureYears * 12;
  const emi = r === 0 ? loan / n : (loan * r * (1 + r) ** n) / ((1 + r) ** n - 1);
  let bal = loan;
  let interest = 0;
  let principal = 0;
  for (let m = 0; m < Math.min(months, n); m++) {
    const int = bal * r;
    const pr = emi - int;
    interest += int;
    principal += pr;
    bal -= pr;
  }
  return { emi: Math.round(emi), interest: Math.round(interest), principal: Math.round(principal), balance: Math.round(bal) };
}

function homeLoan(profile: TaxProfile, raw: unknown): ScenarioResult {
  const i = ScenarioInputSchemas.home_loan.parse(raw);
  const a = amortize(i.loan, i.ratePct, i.tenureYears, i.monthsInYear);
  const after = clone(profile);
  if (i.occupancy === 'self_occupied') after.houseProperty.selfOccupiedInterest += a.interest;
  else after.houseProperty.letOut.push({ label: 'New property', annualRent: i.expectedAnnualRent, municipalTax: 0, homeLoanInterest: a.interest });
  after.deductions.homeLoanPrincipal += a.principal;
  const res = finish('home_loan', profile, after, { ruleIds: ['HP-24B', 'DED-80C'] });
  res.insights.push({ kind: 'info', text: `EMI ${inr(a.emi)}. In this Tax Year: interest ${inr(a.interest)}, principal ${inr(a.principal)}.`, ruleId: 'HP-24B' });
  if (i.occupancy === 'self_occupied') res.insights.push({ kind: 'info', text: 'Self-occupied: interest (up to Rs 2 lakh) and principal (within 80C) count only in the old regime. The new regime gives no benefit.', ruleId: 'HP-24B' });
  const flipped = res.bestRegimeAfter !== (res.before.old < res.before.new ? 'old' : 'new');
  if (flipped) res.insights.push({ kind: 'saving', text: `With this loan the ${res.bestRegimeAfter} regime now wins by ${inr(Math.abs(res.after.new - res.after.old))}.`, ruleId: 'REGIME-OLD' });
  res.details.amortization = a;
  return res;
}

function salaryChange(profile: TaxProfile, raw: unknown): ScenarioResult {
  const i = ScenarioInputSchemas.salary_change.parse(raw);
  const basic = Math.round((i.ctc * i.basicPct) / 100);
  const hra = Math.round((basic * i.hraPctOfBasic) / 100);
  const nps = Math.round((basic * i.employerNpsPctOfBasic) / 100);
  const pf = Math.round(Math.min(basic, 180000) * 0.12); // employer PF, part of CTC but not taxable salary
  const special = Math.max(0, i.ctc - basic - hra - nps - pf - i.bonus);
  const after = clone(profile);
  after.salary = { ...after.salary, basic, da: 0, hra, employerNps: nps, specialAllowance: special, otherAllowances: 0, bonus: i.bonus, perquisites: 0 };
  if (i.city) after.personal.city = i.city;
  if (i.rentPaid !== undefined) after.salary.rentPaid = i.rentPaid;
  const res = finish('salary_change', profile, after, { ruleIds: ['HRA', 'DED-80CCD2'] });
  const grossBefore = res.beforeResult.income.salary.gross;
  const grossAfter = res.afterResult.income.salary.gross;
  const bestAfter = Math.min(res.after.new, res.after.old);
  const takeHomeBefore = grossBefore - profile.salary.employerNps - Math.min(res.before.new, res.before.old);
  const takeHomeAfter = grossAfter - nps - bestAfter;
  res.insights.push({ kind: 'info', text: `Annual take-home (after tax, before employee PF): ${inr(takeHomeBefore)} → ${inr(takeHomeAfter)} (${inr((takeHomeAfter - takeHomeBefore) / 12)} a month).` });
  res.insights.push({ kind: 'info', text: `Recommended regime after the change: ${res.bestRegimeAfter} (${inr(Math.abs(res.after.new - res.after.old))} cheaper).`, ruleId: 'REGIME-NEW' });
  const pack = getPack(profile.taxYear, 'old');
  const metroBefore = pack.hra.metros.includes(profile.personal.city.toLowerCase());
  const metroAfter = pack.hra.metros.includes(after.personal.city.toLowerCase());
  if (metroBefore !== metroAfter) res.insights.push({ kind: 'info', text: `HRA metro status changes (${metroAfter ? '50%' : '40%'} of basic in the old regime).`, ruleId: 'HRA' });
  res.details.structure = { basic, hra, employerNps: nps, employerPf: pf, specialAllowance: special, bonus: i.bonus, takeHomeBefore, takeHomeAfter };
  return res;
}

function investDeduction(profile: TaxProfile, raw: unknown): ScenarioResult {
  const i = ScenarioInputSchemas.invest_deduction.parse(raw);
  const after = clone(profile);
  const ruleMap = { sec80C: 'DED-80C', sec80CCD1B: 'DED-80CCD1B', healthSelf: 'DED-80D', healthParents: 'DED-80D', sec80E: 'DED-80E', employerNps: 'DED-80CCD2' } as const;
  if (i.kind === 'employerNps') {
    after.salary.employerNps += i.amount;
    after.salary.specialAllowance = Math.max(0, after.salary.specialAllowance - i.amount);
  } else after.deductions[i.kind] += i.amount;
  const res = finish('invest_deduction', profile, after, { ruleIds: [ruleMap[i.kind]] });
  const oldSaved = res.before.old - res.after.old;
  const newSaved = res.before.new - res.after.new;
  res.insights.push({ kind: oldSaved > 0 ? 'saving' : 'info', amount: oldSaved, text: `Old regime: saves ${inr(oldSaved)}.`, ruleId: ruleMap[i.kind] });
  res.insights.push({ kind: newSaved > 0 ? 'saving' : 'info', amount: newSaved, text: newSaved > 0 ? `New regime: saves ${inr(newSaved)}.` : 'New regime: no effect. This deduction is not allowed in the new regime.', ruleId: i.kind === 'employerNps' ? 'DED-80CCD2' : 'REGIME-NEW' });
  return res;
}

function redeemSgb(profile: TaxProfile, raw: unknown): ScenarioResult {
  const i = ScenarioInputSchemas.redeem_sgb.parse(raw);
  const after = clone(profile);
  after.capitalGains.push(CapitalGainTxnSchema.parse({
    id: 'scn-sgb', label: `SGB × ${i.units}`, assetType: 'sgb', buyDate: i.buyDate, sellDate: i.redeemDate,
    cost: Math.round(i.units * i.buyPrice), saleValue: Math.round(i.units * i.redemptionPrice), sgbRoute: i.route,
  }));
  const res = finish('redeem_sgb', profile, after, { ruleIds: ['CG-SGB'] });
  const t = res.afterResult.income.capitalGains.txns.find((x) => x.id === 'scn-sgb');
  res.insights.push({ kind: t?.bucket === 'exempt' ? 'saving' : 'info', text: t?.bucket === 'exempt' ? 'Exempt: bought at original issue and held to maturity.' : `Taxable: ${t?.notes.join(' ')} Gain ${inr(t?.gain ?? 0)} (${t?.term}-term).`, ruleId: 'CG-SGB' });
  return res;
}

function buyback(profile: TaxProfile, raw: unknown): ScenarioResult {
  const i = ScenarioInputSchemas.buyback.parse(raw);
  const after = clone(profile);
  after.capitalGains.push(CapitalGainTxnSchema.parse({
    id: 'scn-bb', label: `${i.symbol || 'Buyback'} × ${i.shares}`, assetType: 'buyback', buyDate: i.buyDate, sellDate: i.date,
    cost: Math.round(i.shares * i.costPerShare), saleValue: Math.round(i.shares * i.buybackPrice), promoter: i.promoter,
  }));
  const res = finish('buyback', profile, after, { ruleIds: ['CG-BUYBACK'] });
  const t = res.afterResult.income.capitalGains.txns.find((x) => x.id === 'scn-bb');
  res.insights.push({ kind: 'info', text: `${t?.notes.join(' ')} Gain ${inr(t?.gain ?? 0)}, ${t?.term}-term.`, ruleId: 'CG-BUYBACK' });
  if (i.promoter) res.insights.push({ kind: 'warning', text: 'Promoter buyback taxation is modelled at a 30% effective rate; confirm with a CA.', ruleId: 'CG-BUYBACK' });
  return res;
}

function switchRegime(profile: TaxProfile, raw: unknown): ScenarioResult {
  const i = ScenarioInputSchemas.switch_regime.parse(raw);
  const after = clone(profile);
  after.regime = i.regime;
  return finish('switch_regime', profile, after, { ruleIds: ['REGIME-NEW', 'REGIME-OLD'] });
}

const RUNNERS: Record<ScenarioType, (p: TaxProfile, i: unknown) => ScenarioResult> = {
  sell_equity: sellEquity,
  sell_property: sellProperty,
  home_loan: homeLoan,
  salary_change: salaryChange,
  invest_deduction: investDeduction,
  redeem_sgb: redeemSgb,
  buyback,
  switch_regime: switchRegime,
};

/** Run a what-if scenario. Never mutates the input profile. */
export function runScenario(profileInput: TaxProfile | TaxProfileInput, type: ScenarioType, inputs: unknown): ScenarioResult {
  const profile = TaxProfileSchema.parse(profileInput);
  const runner = RUNNERS[type];
  if (!runner) throw new Error(`Unknown scenario type: ${type}`);
  return runner(clone(profile), inputs);
}
