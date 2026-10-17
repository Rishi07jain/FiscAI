import type { VdaTxn } from '@fiscai/shared-types';
import { getPack } from './packs';

export interface VdaSummary {
  txns: (VdaTxn & { gain: number; tax: number })[];
  totalGains: number;
  totalLossesIgnored: number;
  tax: number;
  cess: number;
  tdsCredit: number;
  expectedTds: number;
  tdsGap: number;
  ruleIds: string[];
  notes: string[];
}

/** F15: flat 30% on each gain, losses ignored, 1% TDS credit tracking. */
export function summariseVda(txns: VdaTxn[], taxYear = '2026-27'): VdaSummary {
  const pack = getPack(taxYear, 'new');
  const rate = pack.specialRates.vda.rate;
  const rows = txns.map((t) => {
    const gain = t.saleValue - t.cost;
    return { ...t, gain, tax: gain > 0 ? Math.round(gain * rate) : 0 };
  });
  const gains = rows.reduce((s, r) => s + Math.max(0, r.gain), 0);
  const losses = rows.reduce((s, r) => s + Math.max(0, -r.gain), 0);
  const tax = Math.round(gains * rate);
  const tds = rows.reduce((s, r) => s + r.tdsDeducted, 0);
  const expected = Math.round(rows.reduce((s, r) => s + r.saleValue, 0) * pack.specialRates.vda.tdsRate);
  return {
    txns: rows, totalGains: gains, totalLossesIgnored: losses, tax, cess: Math.round(tax * pack.cess), tdsCredit: tds, expectedTds: expected, tdsGap: expected - tds,
    ruleIds: ['VDA-30'],
    notes: [
      'Each profitable transfer is taxed at 30% plus cess; a loss on one coin cannot reduce the gain on another.',
      'TDS of 1% deducted by the exchange is credited against your tax; check it appears in your AIS/26AS.',
      ...(losses ? [`Rs ${losses.toLocaleString('en-IN')} of losses are ignored and cannot be carried forward.`] : []),
    ],
  };
}
