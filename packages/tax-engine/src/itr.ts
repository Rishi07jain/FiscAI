import { TaxProfileSchema, type TaxProfile, type TaxProfileInput } from '@fiscai/shared-types';
import { computeTax, type TaxResult } from './compute';

export interface ItrRecommendation { form: 'ITR-1' | 'ITR-2' | 'ITR-3' | 'ITR-4'; reasons: string[] }

export function recommendItrForm(input: TaxProfile | TaxProfileInput, result?: TaxResult): ItrRecommendation {
  const p = TaxProfileSchema.parse(input);
  const r = result ?? computeTax(p, p.regime, { skipMarginal: true });
  const reasons: string[] = [];
  const b = p.business;
  if (b.fnoProfit !== 0 || b.speculativeProfit !== 0 || b.otherBusinessProfit !== 0 || b.fnoTurnover > 0 || b.speculativeTurnover > 0) {
    reasons.push('You have business income (F&O, intraday or other business): ITR-3.');
    return { form: 'ITR-3', reasons };
  }
  if (b.presumptiveIncome > 0) {
    if (r.totalIncome <= 5000000 && p.personal.residency === 'resident' && p.capitalGains.length === 0) {
      reasons.push('Presumptive business income with total income up to Rs 50 lakh: ITR-4.');
      return { form: 'ITR-4', reasons };
    }
    reasons.push('Presumptive income but other conditions for ITR-4 are not met: ITR-3.');
    return { form: 'ITR-3', reasons };
  }
  const nonLtcgCg = r.income.capitalGains.txns.some((t) => t.bucket !== 'equityLTCG' && t.bucket !== 'exempt');
  const ltcg = r.income.capitalGains.equityLTCG;
  const cf = r.carryForward;
  const why2: string[] = [];
  if (p.personal.residency !== 'resident') why2.push('not an ordinary resident');
  if (r.totalIncome > 5000000) why2.push('total income above Rs 50 lakh');
  if (nonLtcgCg) why2.push('capital gains other than 112A LTCG');
  if (ltcg > 125000) why2.push('112A LTCG above Rs 1.25 lakh');
  if (p.houseProperty.letOut.length + (p.houseProperty.selfOccupiedInterest > 0 ? 1 : 0) > 1) why2.push('more than one house property');
  if (cf.stcl + cf.ltcl + cf.houseProperty > 0 || p.broughtForwardLosses.stcl + p.broughtForwardLosses.ltcl > 0) why2.push('losses to carry forward or set off');
  if (p.vda.length) why2.push('crypto/VDA income');
  if (why2.length) {
    reasons.push(`ITR-2 because: ${why2.join(', ')}.`);
    return { form: 'ITR-2', reasons };
  }
  reasons.push('Salary, up to one house property, other sources and small 112A gains: ITR-1 (Sahaj).');
  return { form: 'ITR-1', reasons };
}

export interface ItrPack {
  generatedAt: string;
  taxYear: string;
  regime: 'new' | 'old';
  form: ItrRecommendation;
  schedules: {
    salary: { gross: number; exemptions: number; standardDeduction: number; professionalTax: number; net: number; employer?: string };
    houseProperty: { selfOccupiedInterest: number; letOutIncome: number; total: number };
    capitalGains: { shortTermSlab: number; shortTerm111A: number; longTerm112A: number; longTerm112: number; longTermIndexed: number; exemptions54: number; txns: TaxResult['income']['capitalGains']['txns'] };
    businessIncome: { fnoTurnover: number; fnoProfit: number; speculativeTurnover: number; speculativeProfit: number; presumptive: number };
    otherSources: TaxResult['income']['otherSources'];
    vda: TaxResult['income']['vda'];
    deductions: TaxResult['deductions'];
    carriedForwardLosses: TaxResult['carryForward'];
    taxComputation: { totalIncome: number; slabTax: number; specialTax: number; rebate: number; surcharge: number; cess: number; totalTax: number; prepaid: TaxResult['prepaid']; balance: number };
  };
  disclaimer: string;
}

export function buildItrPack(input: TaxProfile | TaxProfileInput, now = new Date().toISOString()): ItrPack {
  const p = TaxProfileSchema.parse(input);
  const r = computeTax(p, p.regime);
  const cg = r.income.capitalGains;
  return {
    generatedAt: now,
    taxYear: p.taxYear,
    regime: p.regime,
    form: recommendItrForm(p, r),
    schedules: {
      salary: { gross: r.income.salary.gross, exemptions: r.income.salary.hraExempt, standardDeduction: r.income.salary.standardDeduction, professionalTax: r.income.salary.professionalTax, net: r.income.salary.net, employer: p.salary.employerName },
      houseProperty: { selfOccupiedInterest: r.income.houseProperty.selfOccupied, letOutIncome: r.income.houseProperty.letOut, total: r.income.houseProperty.setOffAllowed },
      capitalGains: { shortTermSlab: cg.slabSTCG, shortTerm111A: cg.equitySTCG, longTerm112A: cg.equityLTCG, longTerm112: cg.otherLTCG, longTermIndexed: cg.indexedLTCG, exemptions54: cg.exempted, txns: cg.txns },
      businessIncome: { fnoTurnover: p.business.fnoTurnover, fnoProfit: p.business.fnoProfit, speculativeTurnover: p.business.speculativeTurnover, speculativeProfit: p.business.speculativeProfit, presumptive: p.business.presumptiveIncome },
      otherSources: r.income.otherSources,
      vda: r.income.vda,
      deductions: r.deductions,
      carriedForwardLosses: r.carryForward,
      taxComputation: { totalIncome: r.totalIncome, slabTax: r.slabTax, specialTax: r.specialTax.total, rebate: r.rebate + r.marginalRelief, surcharge: r.surcharge, cess: r.cess, totalTax: r.totalTax, prepaid: r.prepaid, balance: r.balance },
    },
    disclaimer: 'Prepared by FiscAI for information. FiscAI does not file returns; verify with Form 26AS/AIS and a qualified professional before filing.',
  };
}
