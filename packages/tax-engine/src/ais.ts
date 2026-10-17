import { TaxProfileSchema, type TaxProfile, type TaxProfileInput } from '@fiscai/shared-types';

export type AisCategory = 'salary' | 'interest_savings' | 'interest_fd' | 'dividend' | 'sale_securities' | 'sale_mf' | 'rent_received' | 'vda_transfer' | 'tds' | 'tcs' | 'other';

export interface AisEntry { category: AisCategory; source: string; amount: number; tds?: number; date?: string }

export interface AisMismatch {
  category: AisCategory;
  label: string;
  aisAmount: number;
  profileAmount: number;
  difference: number;
  severity: 'ok' | 'low' | 'high';
  message: string;
  ruleId: string;
}

const LABELS: Record<AisCategory, string> = {
  salary: 'Salary', interest_savings: 'Savings-account interest', interest_fd: 'Deposit interest', dividend: 'Dividends', sale_securities: 'Sale of shares',
  sale_mf: 'Sale of mutual funds', rent_received: 'Rent received', vda_transfer: 'Crypto transfers', tds: 'TDS', tcs: 'TCS', other: 'Other',
};

/** F14: compare AIS entries with the profile and flag gaps that commonly trigger notices. */
export function reconcileAis(input: TaxProfile | TaxProfileInput, entries: AisEntry[]): { items: AisMismatch[]; highCount: number } {
  const p = TaxProfileSchema.parse(input);
  const sum = (c: AisCategory) => entries.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0);
  const tdsSum = entries.reduce((s, e) => s + (e.tds ?? 0), 0) + sum('tds');
  const salaryGross = p.salary.basic + p.salary.da + p.salary.hra + p.salary.specialAllowance + p.salary.otherAllowances + p.salary.bonus + p.salary.perquisites + p.salary.employerNps;
  const saleEquity = p.capitalGains.filter((t) => ['listed_equity', 'buyback'].includes(t.assetType)).reduce((s, t) => s + t.saleValue, 0);
  const saleMf = p.capitalGains.filter((t) => ['equity_mf', 'debt_mf'].includes(t.assetType)).reduce((s, t) => s + t.saleValue, 0);
  const rent = p.houseProperty.letOut.reduce((s, l) => s + l.annualRent, 0);
  const vda = p.vda.reduce((s, v) => s + v.saleValue, 0);
  const rows: [AisCategory, number, string][] = [
    ['salary', salaryGross, 'STD-DED'],
    ['interest_savings', p.otherIncome.savingsInterest, 'AIS'],
    ['interest_fd', p.otherIncome.fdInterest, 'AIS'],
    ['dividend', p.otherIncome.dividends, 'DIV-INT-DED'],
    ['sale_securities', saleEquity, 'CG-EQ-STCG'],
    ['sale_mf', saleMf, 'CG-EQ-LTCG'],
    ['rent_received', rent, 'HP-24B'],
    ['vda_transfer', vda, 'VDA-30'],
  ];
  const items: AisMismatch[] = [];
  for (const [cat, mine, ruleId] of rows) {
    const ais = sum(cat);
    if (ais === 0 && mine === 0) continue;
    const diff = ais - mine;
    const tol = Math.max(100, ais * 0.01);
    const severity: AisMismatch['severity'] = Math.abs(diff) <= tol ? 'ok' : diff > 0 ? 'high' : 'low';
    items.push({
      category: cat, label: LABELS[cat], aisAmount: ais, profileAmount: mine, difference: diff, severity, ruleId,
      message: severity === 'ok' ? 'Matches.' : diff > 0
        ? `AIS reports Rs ${diff.toLocaleString('en-IN')} more than your profile. Unreported ${LABELS[cat].toLowerCase()} is a common notice trigger; add it or get the source corrected.`
        : `Your profile shows Rs ${(-diff).toLocaleString('en-IN')} more than AIS. Fine if you have records; the AIS may be incomplete.`,
    });
  }
  const myTds = p.taxesPaid.tds + p.vda.reduce((s, v) => s + v.tdsDeducted, 0);
  if (tdsSum || myTds) {
    const diff = tdsSum - myTds;
    items.push({ category: 'tds', label: 'TDS credit', aisAmount: tdsSum, profileAmount: myTds, difference: diff, severity: Math.abs(diff) <= 100 ? 'ok' : diff > 0 ? 'low' : 'high', ruleId: 'AIS',
      message: Math.abs(diff) <= 100 ? 'Matches.' : diff > 0 ? `AIS shows Rs ${diff.toLocaleString('en-IN')} more TDS than you entered. You may be under-claiming credit.` : `You claim Rs ${(-diff).toLocaleString('en-IN')} more TDS than the AIS shows; the excess credit will be denied.` });
  }
  return { items, highCount: items.filter((i) => i.severity === 'high').length };
}
