import { describe, expect, it } from 'vitest';
import type { TaxProfileInput } from '@fiscai/shared-types';
import { advanceTaxPlan, compareRegimes, computeTax, runScenario, summariseFno, summariseVda, deductionFinder, generateDeadlines, recommendItrForm, reconcileAis, harvest, buildPortfolio } from '../src';

// Hand-verified golden cases. Expected values are total tax (incl. cess, rounded to Rs 10).
type Case = { name: string; profile: TaxProfileInput; regime: 'new' | 'old'; expected: number; extra?: (r: ReturnType<typeof computeTax>) => void };

const salary = (gross: number, extra: Partial<TaxProfileInput> = {}, taxYear: '2025-26' | '2026-27' = '2026-27'): TaxProfileInput => ({
  taxYear,
  personal: { city: 'Other', ageBand: 'below60', residency: 'resident' },
  ...extra,
  salary: { basic: gross, ...(extra.salary ?? {}) },
});

const eq = (buyDate: string, sellDate: string, cost: number, saleValue: number, assetType = 'listed_equity') => ({ assetType, buyDate, sellDate, cost, saleValue } as const);

const cases: Case[] = [
  // ---- New regime, TY 2026-27 ------------------------------------------------
  { name: 'N01 zero income', profile: salary(0), regime: 'new', expected: 0 },
  { name: 'N02 salary 8L under rebate', profile: salary(800000), regime: 'new', expected: 0 },
  { name: 'N03 salary 12.75L → exactly 12L taxable, zero tax', profile: salary(1275000), regime: 'new', expected: 0, extra: (r) => { expect(r.totalIncome).toBe(1200000); expect(r.rebate).toBe(60000); } },
  { name: 'N04 salary 13L → marginal relief', profile: salary(1300000), regime: 'new', expected: 26000, extra: (r) => expect(r.marginalRelief).toBe(38750) },
  { name: 'N05 12.5L taxable in relief zone', profile: salary(1325000), regime: 'new', expected: 52000, extra: (r) => expect(r.marginalRelief).toBe(17500) },
  { name: 'N06 12.71L taxable → relief ends', profile: salary(1346000), regime: 'new', expected: 73480, extra: (r) => expect(r.marginalRelief).toBe(0) },
  { name: 'N07 salary 20L', profile: salary(2000000), regime: 'new', expected: 192400 },
  { name: 'N08 salary 24.75L → 24L taxable', profile: salary(2475000), regime: 'new', expected: 312000 },
  { name: 'N09 exactly 50L taxable, no surcharge', profile: salary(5075000), regime: 'new', expected: 1123200, extra: (r) => expect(r.surcharge).toBe(0) },
  { name: 'N10 51L taxable, surcharge marginal relief', profile: salary(5175000), regime: 'new', expected: 1227200, extra: (r) => { expect(r.surchargeRelief).toBe(41000); expect(r.surcharge).toBe(70000); } },
  { name: 'N11 exactly 1Cr taxable, 10% surcharge', profile: salary(10075000), regime: 'new', expected: 2951520 },
  { name: 'N12 HRA ignored in new regime', profile: salary(0, { salary: { basic: 1000000, hra: 500000, rentPaid: 600000 } as any, personal: { city: 'Mumbai' } as any }), regime: 'new', expected: 97500, extra: (r) => expect(r.income.salary.hraExempt).toBe(0) },
  { name: 'N13 employer NPS deduction within 14%', profile: salary(0, { salary: { basic: 1000000, specialAllowance: 235000, employerNps: 140000 } as any }), regime: 'new', expected: 0, extra: (r) => expect(r.deductions.total).toBe(140000) },
  { name: 'N14 employer NPS capped at 14%', profile: salary(0, { salary: { basic: 1000000, specialAllowance: 300000, employerNps: 200000 } as any }), regime: 'new', expected: 75660, extra: (r) => expect(r.deductions.total).toBe(140000) },
  { name: 'N15 self-occupied interest disallowed in new', profile: salary(1200000, { houseProperty: { selfOccupiedInterest: 250000 } as any }), regime: 'new', expected: 0, extra: (r) => expect(r.income.houseProperty.setOffAllowed).toBe(0) },

  // ---- Old regime --------------------------------------------------------------
  { name: 'O01 salary 10L + 80C 1.5L', profile: salary(1000000, { deductions: { sec80C: 150000 } as any }), regime: 'old', expected: 75400 },
  { name: 'O02 old rebate at exactly 5L', profile: salary(550000), regime: 'old', expected: 0 },
  { name: 'O03 old no marginal relief above 5L', profile: salary(560000), regime: 'old', expected: 15080 },
  { name: 'O04 senior 60-79 at 5L', profile: salary(550000, { personal: { ageBand: '60to79', city: 'Other' } as any }), regime: 'old', expected: 0 },
  { name: 'O05 super-senior 10L taxable', profile: salary(1050000, { personal: { ageBand: '80plus', city: 'Other' } as any }), regime: 'old', expected: 104000 },
  { name: 'O06 HRA Bengaluru TY2026-27 = metro 50%', profile: salary(0, { salary: { basic: 600000, hra: 300000, rentPaid: 400000 } as any, personal: { city: 'Bengaluru' } as any }), regime: 'old', expected: 23400, extra: (r) => { expect(r.income.salary.hraExempt).toBe(300000); expect(r.income.salary.isMetro).toBe(true); } },
  { name: 'O07 HRA Bengaluru TY2025-26 = non-metro 40%', profile: salary(0, { salary: { basic: 600000, hra: 300000, rentPaid: 400000 } as any, personal: { city: 'Bengaluru' } as any }, '2025-26'), regime: 'old', expected: 35880, extra: (r) => expect(r.income.salary.hraExempt).toBe(240000) },
  { name: 'O08 80C/80D caps incl. senior parents', profile: salary(1500000, { deductions: { sec80C: 200000, healthSelf: 30000, healthParents: 60000 } as any, personal: { parentsSenior: true, city: 'Other' } as any }), regime: 'old', expected: 187200, extra: (r) => expect(r.deductions.total).toBe(225000) },
  { name: 'O09 self-occupied interest capped at 2L', profile: salary(1200000, { houseProperty: { selfOccupiedInterest: 250000 } as any }), regime: 'old', expected: 106600 },
  { name: 'O10 80TTA savings interest', profile: salary(1000000, { otherIncome: { savingsInterest: 15000 } as any }), regime: 'old', expected: 107640, extra: (r) => expect(r.deductions.items.find((i) => i.key === 'sec80TTA')?.allowed).toBe(10000) },
  { name: 'O11 professional tax', profile: salary(1000000, { salary: { professionalTax: 2500 } as any }), regime: 'old', expected: 106080 },

  // ---- Capital gains -----------------------------------------------------------
  { name: 'C01 LTCG pushes income above 12L: rebate lost', profile: salary(1275000, { capitalGains: [eq('2024-01-01', '2026-06-01', 100000, 325000)] as any }), regime: 'new', expected: 75400 },
  { name: 'C02 STCG only, basic exemption adjusted, no rebate on 111A', profile: { taxYear: '2026-27', capitalGains: [eq('2026-01-01', '2026-06-01', 500000, 1000000)] as any }, regime: 'new', expected: 20800, extra: (r) => expect(r.basicExemptionAdjusted).toBe(400000) },
  { name: 'C03 STCL offsets LTCG', profile: salary(2000000, { capitalGains: [eq('2024-01-01', '2026-06-01', 100000, 400000), eq('2026-05-01', '2026-06-01', 200000, 100000)] as any }), regime: 'new', expected: 202150 },
  { name: 'C04 LTCL cannot offset STCG', profile: salary(2000000, { capitalGains: [eq('2026-01-01', '2026-06-01', 100000, 200000), eq('2024-01-01', '2026-06-01', 150000, 100000)] as any }), regime: 'new', expected: 213200, extra: (r) => expect(r.carryForward.ltcl).toBe(50000) },
  { name: 'C05 pre-2024 property: indexed 20% chosen + surcharge', profile: salary(3000000, { capitalGains: [{ assetType: 'property', isResidentialHouse: true, buyDate: '2012-06-01', sellDate: '2026-08-01', cost: 5000000, saleValue: 15000000 }] as any }), regime: 'new', expected: 1724580, extra: (r) => expect(r.income.capitalGains.txns[0].indexation?.chosen).toBe('indexed') },
  { name: 'C06 property with 54EC bonds', profile: salary(3000000, { capitalGains: [{ assetType: 'property', isResidentialHouse: true, buyDate: '2012-06-01', sellDate: '2026-08-01', cost: 5000000, saleValue: 15000000, reinvest: { sec54EC: 5000000 } }] as any }), regime: 'new', expected: 527800 },
  { name: 'C07 debt MF always slab STCG', profile: salary(1275000, { capitalGains: [eq('2020-01-01', '2026-06-01', 100000, 200000, 'debt_mf')] as any }), regime: 'new', expected: 78000 },
  { name: 'C08 SGB bought on secondary market: taxable (Budget 2026)', profile: salary(2000000, { capitalGains: [{ assetType: 'sgb', sgbRoute: 'secondary_market', buyDate: '2020-01-01', sellDate: '2026-06-01', cost: 400000, saleValue: 1500000 }] as any }), regime: 'new', expected: 335400 },
  { name: 'C09 SGB original issue held to maturity: exempt', profile: salary(2000000, { capitalGains: [{ assetType: 'sgb', sgbRoute: 'original_issue_held_to_maturity', buyDate: '2018-06-01', sellDate: '2026-06-01', cost: 400000, saleValue: 1500000 }] as any }), regime: 'new', expected: 192400 },
  { name: 'C10 LTCG within 1.25L exemption', profile: salary(2000000, { capitalGains: [eq('2024-01-01', '2026-06-01', 100000, 225000)] as any }), regime: 'new', expected: 192400 },

  // ---- VDA and business --------------------------------------------------------
  { name: 'V01 crypto 30%, losses ignored', profile: salary(2000000, { vda: [{ cost: 100000, saleValue: 200000 }, { cost: 100000, saleValue: 50000 }] as any }), regime: 'new', expected: 223600, extra: (r) => expect(r.income.vda.lossesIgnored).toBe(50000) },
  { name: 'B01 F&O loss offsets FD interest, not salary', profile: salary(2000000, { business: { fnoProfit: -300000 } as any, otherIncome: { fdInterest: 100000 } as any }), regime: 'new', expected: 192400, extra: (r) => expect(r.carryForward.business).toBe(200000) },
  { name: 'B02 intraday loss only vs speculative', profile: salary(2000000, { business: { speculativeProfit: -50000 } as any }), regime: 'new', expected: 192400, extra: (r) => expect(r.carryForward.speculative).toBe(50000) },
  { name: 'B03 F&O profit at slab', profile: salary(1275000, { business: { fnoProfit: 100000 } as any }), regime: 'new', expected: 78000 },
];

describe('golden cases', () => {
  for (const c of cases) {
    it(c.name, () => {
      const r = computeTax(c.profile, c.regime);
      expect(r.totalTax).toBe(c.expected);
      c.extra?.(r);
      // every result carries a trace and the "why" lines
      expect(r.trace.length).toBeGreaterThan(0);
      expect(r.lines.find((l) => l.key === 'total')?.amount).toBe(r.totalTax);
    });
  }
});

describe('property tests', () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

  it('new regime: normal income ≤ 12L pays zero tax for residents', () => {
    for (let i = 0; i < 200; i++) {
      const gross = Math.round(rand() * 1275000);
      expect(computeTax(salary(gross), 'new').totalTax).toBe(0);
    }
  });

  it('tax never decreases as salary rises (outside the rebate zone)', () => {
    for (const regime of ['new', 'old'] as const) {
      let prev = -1;
      for (let g = 1400000; g <= 30000000; g += 37000 + Math.round(rand() * 50000)) {
        const t = computeTax(salary(g), regime, { skipMarginal: true }).totalTax;
        expect(t).toBeGreaterThanOrEqual(prev);
        prev = t;
      }
    }
  });

  it('take-home never falls by more than cess when gross rises (marginal relief works)', () => {
    // Marginal relief caps tax before cess, so a Rs 1,000 raise can cost at most Rs 40 of cess (+ Rs 10 rounding).
    let prev = -Infinity;
    for (let g = 1200000; g <= 1400000; g += 1000) {
      const t = computeTax(salary(g), 'new', { skipMarginal: true }).totalTax;
      expect(g - t).toBeGreaterThanOrEqual(prev - 50);
      prev = g - t;
    }
  });

  it('engine is deterministic', () => {
    const p = salary(2345678, { capitalGains: [eq('2024-01-01', '2026-06-01', 100000, 600000)] as any });
    expect(computeTax(p, 'old')).toEqual(computeTax(p, 'old'));
  });
});

describe('regime optimiser', () => {
  it('recommends new and finds break-even deductions', () => {
    const c = compareRegimes(salary(1500000, { deductions: { sec80C: 150000, healthSelf: 25000 } as any }));
    expect(c.new.totalTax).toBe(97500);
    expect(c.old.totalTax).toBe(202800);
    expect(c.recommended).toBe('new');
    expect(c.breakEvenDeductions).toBeGreaterThan(368000);
    expect(c.breakEvenDeductions).toBeLessThan(370000);
  });
  it('lists employer NPS as a new-regime lever', () => {
    const c = compareRegimes(salary(0, { salary: { basic: 1000000, specialAllowance: 1000000 } as any }));
    expect(c.levers.find((l) => l.key === 'employerNps')?.taxSaved).toBeGreaterThan(0);
  });
  it('flags switch limits with business income', () => {
    expect(compareRegimes(salary(1000000, { business: { fnoProfit: 10000 } as any })).switchRules.canSwitchEveryYear).toBe(false);
  });
});

describe('scenarios', () => {
  const base = salary(2000000);
  it('sell equity: wait-to-long-term nudge', () => {
    const r = runScenario(base, 'sell_equity', { symbol: 'INFY', lots: [{ qty: 40, buyDate: '2025-11-10', buyPrice: 1000 }], qty: 40, price: 2000, date: '2026-10-18' });
    expect(r.delta).toBe(8320);
    const wait = r.details.wait as { days: number; saving: number };
    expect(wait.days).toBe(24);
    expect(wait.saving).toBe(8320);
  });
  it('sell equity: FIFO across lots', () => {
    const r = runScenario(base, 'sell_equity', { lots: [{ qty: 10, buyDate: '2026-01-01', buyPrice: 100 }, { qty: 10, buyDate: '2023-01-01', buyPrice: 50 }], qty: 15, price: 200, date: '2026-07-01' });
    const pieces = r.details.pieces as { qty: number; buyDate: string; longTerm: boolean }[];
    expect(pieces[0]).toMatchObject({ qty: 10, buyDate: '2023-01-01', longTerm: true });
    expect(pieces[1]).toMatchObject({ qty: 5, longTerm: false });
  });
  it('sell property: both options, deadlines', () => {
    const r = runScenario(salary(3000000), 'sell_property', { buyDate: '2012-06-01', cost: 5000000, saleDate: '2026-08-01', salePrice: 15000000 });
    expect(r.after.chosen).toBe(1724580);
    expect(r.deadlines.find((d) => d.type === 'sec54EC')?.dueDate).toBe('2027-02-01');
    expect(r.deadlines.find((d) => d.type === 'cgas')?.dueDate).toBe('2027-07-31');
  });
  it('invest in 80C: zero effect in new regime, stated plainly', () => {
    const r = runScenario(base, 'invest_deduction', { kind: 'sec80C', amount: 150000 });
    expect(r.after.new).toBe(r.before.new);
    expect(r.before.old - r.after.old).toBe(46800);
    expect(r.insights.some((i) => /no effect/i.test(i.text))).toBe(true);
  });
  it('home loan: old regime gets interest + principal', () => {
    const r = runScenario(salary(1800000), 'home_loan', { price: 8000000, loan: 6000000, ratePct: 8.5, tenureYears: 20, occupancy: 'self_occupied' });
    expect(r.after.new).toBe(r.before.new);
    expect(r.after.old).toBeLessThan(r.before.old);
  });
  it('redeem SGB secondary market → taxable', () => {
    const r = runScenario(base, 'redeem_sgb', { units: 100, buyPrice: 4000, redemptionPrice: 15000, buyDate: '2020-01-01', redeemDate: '2026-06-01', route: 'secondary_market' });
    expect(r.after.chosen).toBe(335400);
  });
  it('buyback taxed as capital gains in TY 2026-27', () => {
    const r = runScenario(base, 'buyback', { shares: 100, buybackPrice: 2000, costPerShare: 1000, buyDate: '2026-01-01', date: '2026-06-01' });
    expect(r.after.chosen - r.before.chosen).toBe(20800);
  });
  it('never mutates the input profile', () => {
    const p = salary(2000000);
    const copy = JSON.stringify(p);
    runScenario(p, 'invest_deduction', { kind: 'sec80C', amount: 1000 });
    expect(JSON.stringify(p)).toBe(copy);
  });
});

describe('advance tax', () => {
  it('instalments and 234B/234C interest', () => {
    const plan = advanceTaxPlan(salary(2000000, { taxesPaid: { tds: 150000 } as any }), '2027-04-01');
    expect(plan.netLiability).toBe(42400);
    expect(plan.required).toBe(true);
    expect(plan.instalments.map((i) => i.requiredCumulative)).toEqual([6360, 19080, 31800, 42400]);
    expect(plan.interest234C).toBe(189 + 570 + 954 + 424);
    expect(plan.interest234B).toBe(1696);
  });
  it('below threshold → not required', () => {
    expect(advanceTaxPlan(salary(2000000, { taxesPaid: { tds: 190000 } as any }), '2026-05-01').required).toBe(false);
  });
  it('capital gains after a due date are excluded from earlier instalments', () => {
    const plan = advanceTaxPlan(salary(0, { capitalGains: [eq('2026-01-01', '2026-11-01', 0, 1000000)] as any }), '2026-05-01');
    expect(plan.instalments[0].requiredCumulative).toBe(0);
    expect(plan.instalments[2].requiredCumulative).toBeGreaterThan(0);
  });
});

describe('P1/P2 modules', () => {
  it('deduction finder headroom', () => {
    const f = deductionFinder(salary(1500000, { regime: 'old', deductions: { sec80C: 90000 } as any }));
    expect(f.headroom.find((h) => h.key === 'sec80C')?.remaining).toBe(60000);
    expect(f.schemes.length).toBeGreaterThan(0);
  });
  it('deadlines from a property sale', () => {
    const d = generateDeadlines(salary(1000000, { capitalGains: [{ assetType: 'property', buyDate: '2012-01-01', sellDate: '2026-08-01', cost: 100, saleValue: 200 }] as any }), '2026-08-02');
    expect(d.map((x) => x.type)).toEqual(expect.arrayContaining(['sec54EC', 'cgas', 'itr_due', 'revised_return']));
  });
  it('ITR form recommendation', () => {
    expect(recommendItrForm(salary(1000000)).form).toBe('ITR-1');
    expect(recommendItrForm(salary(1000000, { capitalGains: [eq('2026-01-01', '2026-06-01', 1, 2)] as any })).form).toBe('ITR-2');
    expect(recommendItrForm(salary(1000000, { business: { fnoProfit: -1 } as any })).form).toBe('ITR-3');
  });
  it('F&O summary and STT impact', () => {
    const s = summariseFno([
      { date: '2026-05-01', symbol: 'NIFTY FUT', segment: 'FUT', pnl: 10000, sellValue: 1000000 },
      { date: '2026-05-02', symbol: 'NIFTY CE', segment: 'OPT', pnl: -4000, sellValue: 20000 },
    ]);
    expect(s.fno.turnover).toBe(14000);
    expect(s.sttImpact.oldRates).toBe(220);
    expect(s.sttImpact.newRates).toBe(530);
  });
  it('VDA summary', () => {
    const s = summariseVda([{ label: '', asset: 'BTC', cost: 100, saleValue: 200, tdsDeducted: 2 }]);
    expect(s.tax).toBe(30);
  });
  it('AIS reconciliation flags unreported interest', () => {
    const r = reconcileAis(salary(1000000), [{ category: 'interest_fd', source: 'SBI', amount: 25000 }]);
    expect(r.highCount).toBe(1);
  });
  it('portfolio FIFO and harvesting', () => {
    const lots = [
      { symbol: 'TCS', assetType: 'listed_equity', qty: 10, buyDate: '2024-01-01', buyPrice: 3000, currentPrice: 4000, charges: 0, source: 'manual' },
      { symbol: 'TCS', assetType: 'listed_equity', qty: 5, buyDate: '2024-01-01', buyPrice: 0, sellDate: '2026-05-01', sellPrice: 4200, charges: 0, source: 'manual' },
      { symbol: 'XYZ', assetType: 'listed_equity', qty: 100, buyDate: '2026-06-01', buyPrice: 500, currentPrice: 400, charges: 0, source: 'manual' },
    ] as any;
    const v = buildPortfolio(lots, '2027-01-10');
    expect(v.holdings.find((h) => h.symbol === 'TCS')?.qty).toBe(5);
    expect(v.totals.realisedLT).toBe(6000);
    const h = harvest(salary(2000000, { capitalGains: [eq('2026-04-10', '2026-06-01', 100000, 150000)] as any }), lots, '2027-01-10');
    expect(h.unusedExemption).toBe(119000);
    expect(h.candidates.some((c) => c.kind === 'ltcg_harvest')).toBe(true);
    expect(h.candidates.some((c) => c.kind === 'loss_harvest')).toBe(true);
  });
});
