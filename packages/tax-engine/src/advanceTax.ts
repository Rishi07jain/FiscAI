import { TaxProfileSchema, type TaxProfile, type TaxProfileInput } from '@fiscai/shared-types';
import { computeTax } from './compute';
import { dateInTaxYear, returnDateFor } from './dates';
import { getPack } from './packs';

export interface Instalment {
  dueDate: string;
  cumulativePct: number;
  requiredCumulative: number; // after capital-gains relief
  paidCumulative: number;
  shortfall: number;
  interest234C: number;
  status: 'paid' | 'short' | 'upcoming' | 'due';
  amountDueNow: number; // what to pay by this date (cumulative required - paid)
}

export interface AdvanceTaxPlan {
  taxYear: string;
  regime: 'new' | 'old';
  estimatedTax: number;
  tdsTcs: number;
  netLiability: number;
  required: boolean;
  reason: string;
  instalments: Instalment[];
  interest234B: number;
  interest234C: number;
  totalInterest: number;
  assumedFilingDate: string;
  ruleIds: string[];
}

/** Interest is computed on amounts rounded down to the nearest Rs 100 (Rule 119A). */
const floor100 = (x: number) => Math.max(0, Math.floor(x / 100) * 100);

export function advanceTaxPlan(input: TaxProfile | TaxProfileInput, asOf: string, opts: { filingDate?: string } = {}): AdvanceTaxPlan {
  const profile = TaxProfileSchema.parse(input);
  const pack = getPack(profile.taxYear, profile.regime);
  const full = computeTax(profile, profile.regime, { skipMarginal: true });
  const tdsTcs = full.prepaid.tds + full.prepaid.tcs + full.prepaid.vdaTds;
  const net = Math.max(0, full.totalTax - tdsTcs);
  const hasBusiness = profile.business.fnoProfit !== 0 || profile.business.speculativeProfit !== 0 || profile.business.otherBusinessProfit !== 0 || profile.business.presumptiveIncome > 0;
  const seniorExempt = profile.personal.ageBand !== 'below60' && profile.personal.residency !== 'nri' && !hasBusiness;
  const threshold = pack.advanceTax.threshold / 100;
  const required = net >= threshold && !seniorExempt;
  const filingDate = opts.filingDate ?? returnDateFor(profile.taxYear, pack.returnDueDates[hasBusiness ? 'ITR-3' : 'ITR-2']);
  const payments = [...profile.taxesPaid.advancePayments].sort((a, b) => a.date.localeCompare(b.date));
  const paidBy = (d: string) => payments.filter((p) => p.date <= d).reduce((s, p) => s + p.amount, 0);
  const rate = pack.advanceTax.interestRatePerMonth;

  const instalments: Instalment[] = [];
  let interest234C = 0;
  const tolerances = [0.12, 0.36, null, null];
  pack.advanceTax.instalments.forEach((ins, idx) => {
    const dueDate = dateInTaxYear(profile.taxYear, ins.due);
    // Capital-gains relief: gains arising after this due date need not be in this instalment.
    const cgUpTo = profile.capitalGains.filter((t) => t.sellDate <= dueDate);
    const partial = computeTax({ ...profile, capitalGains: cgUpTo }, profile.regime, { skipMarginal: true });
    const liabilityHere = Math.max(0, partial.totalTax - tdsTcs);
    const requiredCum = Math.round(liabilityHere * ins.cumulativePct);
    const paidCum = paidBy(dueDate);
    const shortfall = Math.max(0, requiredCum - paidCum);
    const tol = tolerances[idx];
    let interest = 0;
    if (required && shortfall > 0) {
      const toleranceMet = tol !== null && paidCum >= liabilityHere * tol;
      if (!toleranceMet) interest = Math.round(floor100(shortfall) * rate * (idx < 3 ? 3 : 1));
    }
    interest234C += interest;
    const status: Instalment['status'] = asOf > dueDate ? (shortfall > 0 && required ? 'short' : 'paid') : idx === pack.advanceTax.instalments.findIndex((x) => asOf <= dateInTaxYear(profile.taxYear, x.due)) ? 'due' : 'upcoming';
    instalments.push({ dueDate, cumulativePct: ins.cumulativePct, requiredCumulative: requiredCum, paidCumulative: paidCum, shortfall, interest234C: interest, status, amountDueNow: Math.max(0, requiredCum - paidCum) });
  });

  // 234B: paid by 31 March < 90% of assessed tax → 1% per month from April to filing.
  const paidByMarch = paidBy(dateInTaxYear(profile.taxYear, '03-31'));
  let interest234B = 0;
  if (required && paidByMarch < 0.9 * net) {
    const start = Number(profile.taxYear.slice(0, 4)) + 1; // April of next year
    const f = new Date(`${filingDate}T00:00:00Z`);
    const monthsLate = Math.max(1, (f.getUTCFullYear() - start) * 12 + (f.getUTCMonth() - 3) + 1);
    interest234B = Math.round(floor100(net - paidByMarch) * rate * monthsLate);
  }
  return {
    taxYear: profile.taxYear,
    regime: profile.regime,
    estimatedTax: full.totalTax,
    tdsTcs,
    netLiability: net,
    required,
    reason: seniorExempt
      ? 'Resident senior citizens without business income do not pay advance tax.'
      : required
        ? `Tax after TDS is Rs ${net.toLocaleString('en-IN')}, at or above the Rs ${threshold.toLocaleString('en-IN')} threshold.`
        : `Tax after TDS is Rs ${net.toLocaleString('en-IN')}, below the Rs ${threshold.toLocaleString('en-IN')} threshold.`,
    instalments,
    interest234B,
    interest234C: required ? interest234C : 0,
    totalInterest: required ? interest234B + interest234C : 0,
    assumedFilingDate: filingDate,
    ruleIds: ['ADV-TAX', 'ADV-234B', 'ADV-234C'],
  };
}
