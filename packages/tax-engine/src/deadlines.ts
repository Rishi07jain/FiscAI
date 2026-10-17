import { TaxProfileSchema, type TaxProfile, type TaxProfileInput } from '@fiscai/shared-types';
import { advanceTaxPlan } from './advanceTax';
import { addDays, addMonths, dateInTaxYear, returnDateFor } from './dates';
import { recommendItrForm } from './itr';
import { getPack } from './packs';

export interface GeneratedDeadline {
  type: string;
  title: string;
  dueDate: string;
  triggerEvent: string;
  ruleId: string;
  amount?: number;
  remindAt: string[];
}

export const reminderDates = (due: string, offsets = [30, 7, 1]) => offsets.map((d) => addDays(due, -d));

export function generateDeadlines(input: TaxProfile | TaxProfileInput, asOf: string): GeneratedDeadline[] {
  const profile = TaxProfileSchema.parse(input);
  const pack = getPack(profile.taxYear, profile.regime);
  const out: GeneratedDeadline[] = [];
  const push = (d: Omit<GeneratedDeadline, 'remindAt'>) => out.push({ ...d, remindAt: reminderDates(d.dueDate) });

  const plan = advanceTaxPlan(profile, asOf);
  if (plan.required) {
    for (const i of plan.instalments) {
      push({ type: 'advance_tax', title: `Advance tax: ${Math.round(i.cumulativePct * 100)}% instalment`, dueDate: i.dueDate, triggerEvent: 'advance_tax_liability', ruleId: 'ADV-TAX', amount: i.amountDueNow });
    }
  }
  const form = recommendItrForm(profile).form;
  const dueKey = form as keyof typeof pack.returnDueDates;
  const due = returnDateFor(profile.taxYear, pack.returnDueDates[dueKey] ?? pack.returnDueDates['ITR-2']);
  push({ type: 'itr_due', title: `File ${form} for Tax Year ${profile.taxYear}`, dueDate: due, triggerEvent: 'tax_year_end', ruleId: 'ITR-DUE' });
  push({ type: 'revised_return', title: 'Last date for a revised/belated return (fee after 31 Dec)', dueDate: returnDateFor(profile.taxYear, pack.returnDueDates.revised), triggerEvent: 'tax_year_end', ruleId: 'ITR-DUE' });

  const fnoLoss = profile.business.fnoProfit < 0 || profile.business.speculativeProfit < 0;
  if (fnoLoss) push({ type: 'fno_loss_itr3', title: 'File ITR-3 on time to carry forward trading losses', dueDate: returnDateFor(profile.taxYear, pack.returnDueDates['ITR-3']), triggerEvent: 'fno_loss', ruleId: 'FNO-BUSINESS' });
  const cgLoss = profile.capitalGains.some((t) => t.saleValue - t.cost - t.expenses < 0);
  if (cgLoss) push({ type: 'cg_loss_itr', title: 'File by the due date to carry forward capital losses', dueDate: due, triggerEvent: 'capital_loss', ruleId: 'CG-LOSS-SETOFF' });

  for (const t of profile.capitalGains) {
    if (t.assetType !== 'property' && t.assetType !== 'land') continue;
    const label = t.label || 'property sale';
    push({ type: 'sec54EC', title: `Buy 54EC bonds for ${label}`, dueDate: addMonths(t.sellDate, 6), triggerEvent: `property_sale:${t.sellDate}`, ruleId: 'CG-54EC' });
    push({ type: 'cgas', title: `Deposit unused gains of ${label} in CGAS`, dueDate: due, triggerEvent: `property_sale:${t.sellDate}`, ruleId: 'CGAS' });
    push({ type: 'sec54_purchase', title: `Buy the new house for ${label} (Sec 54/54F)`, dueDate: addMonths(t.sellDate, 24), triggerEvent: `property_sale:${t.sellDate}`, ruleId: 'CG-54' });
  }
  if (profile.regime === 'old' || profile.deductions.sec80C > 0) {
    push({ type: 'investment_proof', title: 'Submit investment proofs to your employer', dueDate: dateInTaxYear(profile.taxYear, '01-31'), triggerEvent: 'payroll', ruleId: 'DED-80C' });
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
