import { z } from 'zod';

// All money values in profiles and API payloads are whole rupees.
// The tax engine converts to paise internally (see packages/tax-engine).
const money = z.coerce.number().min(0).default(0);
const signedMoney = z.coerce.number().default(0);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const TAX_YEARS = ['2025-26', '2026-27'] as const;
export const TaxYearSchema = z.enum(TAX_YEARS);
export type TaxYear = z.infer<typeof TaxYearSchema>;

export const RegimeSchema = z.enum(['new', 'old']);
export type Regime = z.infer<typeof RegimeSchema>;

export const AgeBandSchema = z.enum(['below60', '60to79', '80plus']);
export const ResidencySchema = z.enum(['resident', 'rnor', 'nri']);
export const EmploymentSchema = z.enum(['salaried', 'self_employed', 'trader', 'retired', 'student', 'none']);
export const IncomeSourceSchema = z.enum(['salary', 'capital_gains', 'fno', 'rent', 'interest', 'crypto', 'business', 'dividends']);

export const ASSET_TYPES = [
  'listed_equity', 'equity_mf', 'debt_mf', 'property', 'land', 'unlisted_shares', 'gold', 'sgb', 'listed_bond', 'buyback', 'other',
] as const;
export const AssetTypeSchema = z.enum(ASSET_TYPES);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const PersonalSchema = z.object({
  name: z.string().optional(),
  pan: z.string().optional(),
  ageBand: AgeBandSchema.default('below60'),
  residency: ResidencySchema.default('resident'),
  city: z.string().default(''),
  employmentType: EmploymentSchema.default('salaried'),
  incomeSources: z.array(IncomeSourceSchema).default(['salary']),
  parentsSenior: z.boolean().default(false),
});

export const SalarySchema = z.object({
  employerName: z.string().optional(),
  basic: money,
  da: money,
  hra: money,
  specialAllowance: money,
  otherAllowances: money,
  bonus: money,
  perquisites: money,
  employerNps: money,
  professionalTax: money,
  rentPaid: money, // annual rent paid
  landlordRelation: z.string().optional(),
  landlordPan: z.string().optional(),
});

export const LetOutPropertySchema = z.object({
  label: z.string().default('Let-out property'),
  annualRent: money,
  municipalTax: money,
  homeLoanInterest: money,
});

export const HousePropertySchema = z.object({
  selfOccupiedInterest: money,
  letOut: z.array(LetOutPropertySchema).default([]),
});

export const CapitalGainTxnSchema = z.object({
  id: z.string().optional(),
  label: z.string().default(''),
  assetType: AssetTypeSchema,
  buyDate: isoDate,
  sellDate: isoDate,
  cost: money,
  saleValue: money,
  expenses: money,
  improvements: z.array(z.object({ date: isoDate, amount: money })).default([]),
  sttPaid: z.boolean().default(true),
  isResidentialHouse: z.boolean().default(false),
  sgbRoute: z.enum(['original_issue_held_to_maturity', 'secondary_market', 'exchange_sale']).optional(),
  promoter: z.boolean().default(false),
  reinvest: z.object({ sec54: money, sec54F: money, sec54EC: money }).default({}),
});
export type CapitalGainTxn = z.infer<typeof CapitalGainTxnSchema>;

export const BusinessSchema = z.object({
  fnoTurnover: money,
  fnoProfit: signedMoney, // net of charges, may be negative
  speculativeTurnover: money,
  speculativeProfit: signedMoney,
  presumptiveIncome: money,
  otherBusinessProfit: signedMoney,
});

export const OtherIncomeSchema = z.object({
  savingsInterest: money,
  fdInterest: money,
  dividends: money,
  familyPension: money,
  other: money,
});

export const VdaTxnSchema = z.object({
  label: z.string().default(''),
  asset: z.string().default(''),
  buyDate: isoDate.optional(),
  sellDate: isoDate.optional(),
  cost: money,
  saleValue: money,
  tdsDeducted: money,
});
export type VdaTxn = z.infer<typeof VdaTxnSchema>;

export const DeductionsSchema = z.object({
  sec80C: money,
  homeLoanPrincipal: money,
  sec80CCD1B: money,
  healthSelf: money,
  healthParents: money,
  preventiveCheckup: money,
  sec80E: money,
  sec80G: money,
});

export const LossesSchema = z.object({
  stcl: money,
  ltcl: money,
  business: money,
  speculative: money,
  houseProperty: money,
});

export const AdvancePaymentSchema = z.object({ date: isoDate, amount: money });

export const TaxesPaidSchema = z.object({
  tds: money,
  tcs: money,
  advanceTax: money,
  selfAssessment: money,
  advancePayments: z.array(AdvancePaymentSchema).default([]),
});

export const TaxProfileSchema = z.object({
  taxYear: TaxYearSchema.default('2026-27'),
  regime: RegimeSchema.default('new'),
  personal: PersonalSchema.default({}),
  salary: SalarySchema.default({}),
  houseProperty: HousePropertySchema.default({}),
  capitalGains: z.array(CapitalGainTxnSchema).default([]),
  business: BusinessSchema.default({}),
  otherIncome: OtherIncomeSchema.default({}),
  vda: z.array(VdaTxnSchema).default([]),
  deductions: DeductionsSchema.default({}),
  broughtForwardLosses: LossesSchema.default({}),
  taxesPaid: TaxesPaidSchema.default({}),
});
export type TaxProfile = z.infer<typeof TaxProfileSchema>;
export type TaxProfileInput = z.input<typeof TaxProfileSchema>;

export function emptyProfile(taxYear: TaxYear = '2026-27'): TaxProfile {
  return TaxProfileSchema.parse({ taxYear });
}

// ---- Portfolio lots ----
export const LotSchema = z.object({
  assetType: AssetTypeSchema.default('listed_equity'),
  symbol: z.string(),
  isin: z.string().optional(),
  qty: z.coerce.number().positive(),
  buyDate: isoDate,
  buyPrice: z.coerce.number().min(0),
  currentPrice: z.coerce.number().min(0).optional(),
  sellDate: isoDate.optional(),
  sellPrice: z.coerce.number().min(0).optional(),
  charges: money,
  source: z.string().default('manual'),
});
export type Lot = z.infer<typeof LotSchema>;

// ---- Scenarios ----
export const SCENARIO_TYPES = [
  'sell_equity', 'sell_property', 'home_loan', 'salary_change', 'invest_deduction', 'redeem_sgb', 'buyback', 'switch_regime',
] as const;
export const ScenarioTypeSchema = z.enum(SCENARIO_TYPES);
export type ScenarioType = z.infer<typeof ScenarioTypeSchema>;

export const SellEquityInputs = z.object({
  symbol: z.string().default(''),
  assetType: z.enum(['listed_equity', 'equity_mf']).default('listed_equity'),
  lots: z.array(z.object({ qty: z.coerce.number().positive(), buyDate: isoDate, buyPrice: z.coerce.number().min(0) })).min(1),
  qty: z.coerce.number().positive(),
  price: z.coerce.number().min(0),
  date: isoDate,
  charges: money,
});
export const SellPropertyInputs = z.object({
  label: z.string().default('Property'),
  assetType: z.enum(['property', 'land']).default('property'),
  isResidentialHouse: z.boolean().default(true),
  buyDate: isoDate,
  cost: money,
  improvements: z.array(z.object({ date: isoDate, amount: money })).default([]),
  saleDate: isoDate,
  salePrice: money,
  expenses: money,
  reinvest: z.object({ sec54: money, sec54F: money, sec54EC: money }).default({}),
});
export const HomeLoanInputs = z.object({
  price: money,
  loan: money,
  ratePct: z.coerce.number().min(0).max(30),
  tenureYears: z.coerce.number().int().min(1).max(40),
  occupancy: z.enum(['self_occupied', 'let_out']).default('self_occupied'),
  expectedAnnualRent: money,
  monthsInYear: z.coerce.number().int().min(1).max(12).default(12),
});
export const SalaryChangeInputs = z.object({
  ctc: money,
  basicPct: z.coerce.number().min(0).max(100).default(40),
  hraPctOfBasic: z.coerce.number().min(0).max(100).default(50),
  employerNpsPctOfBasic: z.coerce.number().min(0).max(14).default(0),
  bonus: money,
  city: z.string().optional(),
  rentPaid: money.optional(),
});
export const InvestDeductionInputs = z.object({
  kind: z.enum(['sec80C', 'sec80CCD1B', 'healthSelf', 'healthParents', 'sec80E', 'employerNps']),
  amount: money,
});
export const RedeemSgbInputs = z.object({
  units: z.coerce.number().positive(),
  buyPrice: z.coerce.number().min(0),
  redemptionPrice: z.coerce.number().min(0),
  buyDate: isoDate,
  redeemDate: isoDate,
  route: z.enum(['original_issue_held_to_maturity', 'secondary_market', 'exchange_sale']),
});
export const BuybackInputs = z.object({
  symbol: z.string().default(''),
  shares: z.coerce.number().positive(),
  buybackPrice: z.coerce.number().min(0),
  costPerShare: z.coerce.number().min(0),
  buyDate: isoDate,
  date: isoDate,
  promoter: z.boolean().default(false),
});
export const SwitchRegimeInputs = z.object({ regime: RegimeSchema });

export const ScenarioInputSchemas = {
  sell_equity: SellEquityInputs,
  sell_property: SellPropertyInputs,
  home_loan: HomeLoanInputs,
  salary_change: SalaryChangeInputs,
  invest_deduction: InvestDeductionInputs,
  redeem_sgb: RedeemSgbInputs,
  buyback: BuybackInputs,
  switch_regime: SwitchRegimeInputs,
} as const;

// ---- Household ----
export const HouseholdMemberSchema = z.object({
  name: z.string().min(1),
  relation: z.enum(['spouse', 'father', 'mother', 'child', 'other']),
  ageBand: AgeBandSchema.default('below60'),
  profile: TaxProfileSchema.partial().default({}),
  healthPremiumPaidByUser: money,
  giftsFromUser: money,
});
export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;

export const DOCUMENT_TYPES = ['form16', 'ais', 'broker_pnl', 'mf_cas', 'salary_slip', 'rent_receipt', 'crypto_statement'] as const;
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DOCUMENT_STATUSES = ['uploaded', 'parsing', 'needs_review', 'confirmed', 'failed'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface ExtractedField {
  path: string; // dot path into TaxProfile, or 'lots[]' / 'capitalGains[]' / 'ais[]'
  label: string;
  value: unknown;
  confidence: number; // 0..1
  sourceRef: string; // "page 2" or "row 14"
  accepted?: boolean;
}

export const CITY_OPTIONS = [
  'Mumbai', 'Delhi', 'Kolkata', 'Chennai', 'Bengaluru', 'Hyderabad', 'Pune', 'Ahmedabad',
  'Gurugram', 'Noida', 'Jaipur', 'Lucknow', 'Chandigarh', 'Kochi', 'Indore', 'Coimbatore', 'Other',
];
