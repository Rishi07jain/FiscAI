import type { DocumentType } from '@fiscai/shared-types';

export interface ScalarField { path: string; label: string; kind: 'number' | 'text'; hint: string }
export interface ListSpec { target: string; label: string; itemSchema: Record<string, unknown>; hint: string }
export interface DocSpec { type: DocumentType; title: string; scalars: ScalarField[]; list?: ListSpec; instructions: string }

const n = (path: string, label: string, hint = ''): ScalarField => ({ path, label, kind: 'number', hint });
const t = (path: string, label: string, hint = ''): ScalarField => ({ path, label, kind: 'text', hint });

export const SPECS: Record<DocumentType, DocSpec> = {
  form16: {
    type: 'form16',
    title: 'Form 16 (Parts A and B)',
    instructions: 'Extract annual figures from Form 16. If the basic/DA/allowance breakup is not shown, report salary u/s 17(1) minus HRA as salary.basic with confidence at most 0.5. Report TDS as the total tax deducted for the year (Part A). Report deductions claimed under Chapter VI-A only if shown.',
    scalars: [
      t('salary.employerName', 'Employer name'),
      n('salary.basic', 'Basic salary', 'annual'),
      n('salary.da', 'Dearness allowance', 'annual'),
      n('salary.hra', 'HRA received', 'annual'),
      n('salary.specialAllowance', 'Special allowance', 'annual'),
      n('salary.otherAllowances', 'Other allowances', 'annual'),
      n('salary.bonus', 'Bonus / incentives', 'annual'),
      n('salary.perquisites', 'Perquisites u/s 17(2)', 'annual'),
      n('salary.employerNps', 'Employer NPS contribution 80CCD(2)', 'annual'),
      n('salary.professionalTax', 'Professional tax', 'annual, 16(iii)'),
      n('taxesPaid.tds', 'TDS deducted by employer', 'total for the year'),
      n('deductions.sec80C', '80C deductions claimed'),
      n('deductions.sec80CCD1B', '80CCD(1B) claimed'),
      n('deductions.healthSelf', '80D – self/family'),
      n('deductions.healthParents', '80D – parents'),
      t('regime', 'Regime opted (new/old)', 'write "new" if Section 115BAC is opted, else "old"'),
    ],
  },
  salary_slip: {
    type: 'salary_slip',
    title: 'Salary slip',
    instructions: 'Extract MONTHLY earnings and deductions from the salary slip. Use the current month column, not year-to-date. Set months_covered to 1 unless the slip is explicitly annual.',
    scalars: [
      t('salary.employerName', 'Employer name'),
      n('salary.basic', 'Basic (monthly)'),
      n('salary.da', 'DA (monthly)'),
      n('salary.hra', 'HRA (monthly)'),
      n('salary.specialAllowance', 'Special allowance (monthly)'),
      n('salary.otherAllowances', 'Other allowances (monthly)'),
      n('salary.employerNps', 'Employer NPS (monthly)'),
      n('salary.professionalTax', 'Professional tax (monthly)'),
      n('taxesPaid.tds', 'Income tax deducted (monthly)'),
      n('meta.monthsCovered', 'Months covered', 'usually 1'),
    ],
  },
  rent_receipt: {
    type: 'rent_receipt',
    title: 'Rent receipt',
    instructions: 'Extract the monthly rent and the number of months covered by the receipt(s). The landlord PAN is redacted; do not guess it. Report the landlord relationship only if stated.',
    scalars: [
      n('meta.monthlyRent', 'Monthly rent'),
      n('meta.monthsCovered', 'Months covered'),
      t('salary.landlordRelation', 'Landlord relationship', 'e.g. unrelated, parent'),
    ],
  },
  ais: {
    type: 'ais',
    title: 'AIS / TIS',
    instructions: 'List every reported information item with its category, the reporting source (bank, company, employer) and the reported amount and TDS. Categories: salary, interest_savings, interest_fd, dividend, sale_securities, sale_mf, rent_received, vda_transfer, tds, tcs, other.',
    scalars: [],
    list: {
      target: 'aisEntries[]',
      label: 'AIS entry',
      hint: 'one item per AIS row',
      itemSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['salary', 'interest_savings', 'interest_fd', 'dividend', 'sale_securities', 'sale_mf', 'rent_received', 'vda_transfer', 'tds', 'tcs', 'other'] },
          source: { type: 'string' },
          amount: { type: 'number' },
          tds: { type: 'number' },
        },
        required: ['category', 'amount'],
      },
    },
  },
  mf_cas: {
    type: 'mf_cas',
    title: 'Mutual fund CAS (CAMS/KFintech)',
    instructions: 'List each purchase and redemption transaction per folio with date (YYYY-MM-DD), units, NAV/price and amount. Classify each scheme as equity (equity/ELSS/index/hybrid-equity, >=65% equity) or debt. Skip stamp duty and STT rows.',
    scalars: [],
    list: {
      target: 'lots[]',
      label: 'MF transaction',
      hint: 'one item per transaction',
      itemSchema: {
        type: 'object',
        properties: {
          scheme: { type: 'string' },
          isin: { type: 'string' },
          fundType: { type: 'string', enum: ['equity', 'debt'] },
          txnType: { type: 'string', enum: ['purchase', 'redemption'] },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          units: { type: 'number' },
          price: { type: 'number' },
          amount: { type: 'number' },
        },
        required: ['scheme', 'txnType', 'date', 'units'],
      },
    },
  },
  broker_pnl: {
    type: 'broker_pnl',
    title: 'Broker capital gains / P&L',
    instructions: 'List each realised trade. For equity delivery trades give symbol, buy date, sell date, quantity, buy value and sell value. For F&O give date, symbol, segment (FUT or OPT), realised P&L and the sell-side value or premium.',
    scalars: [],
    list: {
      target: 'trades[]',
      label: 'Trade',
      hint: 'one item per realised trade',
      itemSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['equity', 'fno', 'intraday'] },
          symbol: { type: 'string' },
          isin: { type: 'string' },
          buyDate: { type: 'string' },
          sellDate: { type: 'string' },
          qty: { type: 'number' },
          buyValue: { type: 'number' },
          sellValue: { type: 'number' },
          pnl: { type: 'number' },
          segment: { type: 'string', enum: ['FUT', 'OPT', 'INTRADAY_EQ'] },
          charges: { type: 'number' },
        },
        required: ['kind', 'symbol'],
      },
    },
  },
  crypto_statement: {
    type: 'crypto_statement',
    title: 'Crypto / VDA statement',
    instructions: 'List each sale or transfer of a virtual digital asset with asset name, buy cost, sale value, dates and the 1% TDS deducted.',
    scalars: [],
    list: {
      target: 'vda[]',
      label: 'VDA transfer',
      hint: 'one item per transfer',
      itemSchema: {
        type: 'object',
        properties: {
          asset: { type: 'string' },
          buyDate: { type: 'string' },
          sellDate: { type: 'string' },
          cost: { type: 'number' },
          saleValue: { type: 'number' },
          tdsDeducted: { type: 'number' },
        },
        required: ['asset', 'saleValue'],
      },
    },
  },
};

/** JSON schema the LLM must return. Every value carries confidence and a page/row reference. */
export function responseSchemaFor(spec: DocSpec): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (spec.scalars.length) {
    props.fields = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', enum: spec.scalars.map((s) => s.path) },
          number: { type: 'number' },
          text: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          page: { type: 'integer' },
        },
        required: ['path', 'confidence', 'page'],
      },
    };
  }
  if (spec.list) {
    const base = spec.list.itemSchema as { properties: Record<string, unknown>; required: string[] };
    props.items = {
      type: 'array',
      items: {
        type: 'object',
        properties: { ...base.properties, confidence: { type: 'number' }, ref: { type: 'string', description: 'page N or row N' } },
        required: [...base.required, 'confidence', 'ref'],
      },
    };
  }
  return { type: 'object', properties: props, required: Object.keys(props) };
}
