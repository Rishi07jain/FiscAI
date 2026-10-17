import { CapitalGainTxnSchema, TaxProfileSchema, type CapitalGainTxn, type Lot, type TaxProfile, type TaxProfileInput } from '@fiscai/shared-types';
import { computeTax } from './compute';
import { daysBetween, isLongTerm, longTermFrom, taxYearBounds } from './dates';
import { getPack } from './packs';

export interface Holding {
  key: string; // symbol|buyDate
  symbol: string;
  isin?: string;
  assetType: string;
  qty: number;
  buyDate: string;
  buyPrice: number;
  currentPrice: number | null;
  cost: number;
  value: number | null;
  unrealised: number | null;
  term: 'short' | 'long';
  longTermOn: string | null;
  daysToLongTerm: number | null;
  waitSaving: number | null; // tax saved by waiting until long-term, if selling this lot now
}

export interface RealisedSale extends CapitalGainTxn { symbol: string; qty: number }

export interface PortfolioView {
  asOf: string;
  holdings: Holding[];
  realised: RealisedSale[];
  totals: { cost: number; value: number; unrealisedST: number; unrealisedLT: number; realisedST: number; realisedLT: number };
  countdown: Holding[]; // lots turning long-term within 60 days with gains
}

const months = (assetType: string, profileYear = '2026-27'): number | null => {
  const v = getPack(profileYear, 'new').holdingPeriods[assetType];
  return v === undefined ? 24 : v;
};

/**
 * Lot-level FIFO: open lots are buys; lots with sellDate are sells (qty sold at sellPrice).
 * Sells consume the oldest open buys of the same symbol.
 */
export function buildPortfolio(lots: Lot[], asOf: string, taxYear = '2026-27', profile?: TaxProfile): PortfolioView {
  const bySymbol = new Map<string, Lot[]>();
  for (const l of lots) {
    const k = (l.isin || l.symbol).toUpperCase();
    if (!bySymbol.has(k)) bySymbol.set(k, []);
    bySymbol.get(k)!.push(l);
  }
  const holdings: Holding[] = [];
  const realised: RealisedSale[] = [];
  for (const [, group] of bySymbol) {
    const buys = group.filter((l) => !l.sellDate).map((l) => ({ ...l })).sort((a, b) => a.buyDate.localeCompare(b.buyDate));
    const sells = group.filter((l) => l.sellDate).sort((a, b) => a.sellDate!.localeCompare(b.sellDate!));
    for (const s of sells) {
      // A sell row may carry its own buyDate/buyPrice (broker P&L format) — treat as already matched.
      if (s.buyDate && s.buyPrice !== undefined && !buys.length) {
        realised.push(toTxn(s, s.qty, s.buyDate, s.buyPrice));
        continue;
      }
      let left = s.qty;
      while (left > 1e-9 && buys.length) {
        const b = buys[0];
        const q = Math.min(b.qty, left);
        realised.push(toTxn(s, q, b.buyDate, b.buyPrice));
        b.qty -= q;
        left -= q;
        if (b.qty <= 1e-9) buys.shift();
      }
      if (left > 1e-9) realised.push(toTxn(s, left, s.buyDate, s.buyPrice));
    }
    for (const b of buys) {
      const m = months(b.assetType, taxYear);
      const long = isLongTerm(b.buyDate, asOf, m);
      const ltOn = m === null ? null : longTermFrom(b.buyDate, m);
      const cost = Math.round(b.qty * b.buyPrice + (b.charges || 0));
      const value = b.currentPrice !== undefined ? Math.round(b.qty * b.currentPrice) : null;
      holdings.push({
        key: `${b.symbol}|${b.buyDate}`, symbol: b.symbol, isin: b.isin, assetType: b.assetType, qty: b.qty, buyDate: b.buyDate, buyPrice: b.buyPrice,
        currentPrice: b.currentPrice ?? null, cost, value, unrealised: value === null ? null : value - cost,
        term: long ? 'long' : 'short', longTermOn: long ? null : ltOn, daysToLongTerm: long || !ltOn ? null : daysBetween(asOf, ltOn), waitSaving: null,
      });
    }
  }

  const [tyStart, tyEnd] = taxYearBounds(taxYear);
  const realisedThisYear = realised.filter((r) => r.sellDate >= tyStart && r.sellDate <= tyEnd);
  const gain = (r: CapitalGainTxn) => r.saleValue - r.cost - r.expenses;
  const isLT = (r: CapitalGainTxn) => isLongTerm(r.buyDate, r.sellDate, months(r.assetType, taxYear));

  // Wait-saving for short-term lots with gains turning long-term soon (engine-computed).
  if (profile) {
    const base = TaxProfileSchema.parse({ ...profile, capitalGains: [...profile.capitalGains, ...realisedThisYear] });
    for (const h of holdings) {
      if (h.term === 'short' && h.unrealised !== null && h.unrealised > 0 && h.daysToLongTerm !== null && h.daysToLongTerm <= 365 && h.currentPrice !== null && ['listed_equity', 'equity_mf'].includes(h.assetType)) {
        const mk = (d: string) => CapitalGainTxnSchema.parse({ label: h.symbol, assetType: h.assetType, buyDate: h.buyDate, sellDate: d, cost: h.cost, saleValue: h.value!, sttPaid: true });
        const now = computeTax({ ...base, capitalGains: [...base.capitalGains, mk(asOf)] }, base.regime, { skipMarginal: true }).totalTax;
        const later = computeTax({ ...base, capitalGains: [...base.capitalGains, mk(h.longTermOn!)] }, base.regime, { skipMarginal: true }).totalTax;
        h.waitSaving = Math.max(0, now - later);
      }
    }
  }

  const totals = {
    cost: holdings.reduce((s, h) => s + h.cost, 0),
    value: holdings.reduce((s, h) => s + (h.value ?? h.cost), 0),
    unrealisedST: holdings.filter((h) => h.term === 'short').reduce((s, h) => s + (h.unrealised ?? 0), 0),
    unrealisedLT: holdings.filter((h) => h.term === 'long').reduce((s, h) => s + (h.unrealised ?? 0), 0),
    realisedST: realisedThisYear.filter((r) => !isLT(r)).reduce((s, r) => s + gain(r), 0),
    realisedLT: realisedThisYear.filter(isLT).reduce((s, r) => s + gain(r), 0),
  };
  const countdown = holdings
    .filter((h) => h.term === 'short' && h.daysToLongTerm !== null && h.daysToLongTerm <= 60 && (h.unrealised ?? 0) > 0)
    .sort((a, b) => a.daysToLongTerm! - b.daysToLongTerm!);
  return { asOf, holdings, realised, totals, countdown };
}

function toTxn(s: Lot, qty: number, buyDate: string, buyPrice: number): RealisedSale {
  const ratio = qty / s.qty;
  return {
    ...CapitalGainTxnSchema.parse({
      label: `${s.symbol} × ${qty}`, assetType: s.assetType, buyDate, sellDate: s.sellDate!,
      cost: Math.round(qty * buyPrice), saleValue: Math.round(qty * (s.sellPrice ?? 0)), expenses: Math.round((s.charges || 0) * ratio), sttPaid: true,
    }),
    symbol: s.symbol,
    qty,
  };
}

/** Realised transactions in a tax year, ready to merge into a profile's capitalGains. */
export function realisedForYear(view: PortfolioView, taxYear: string): CapitalGainTxn[] {
  const [a, b] = taxYearBounds(taxYear);
  return view.realised.filter((r) => r.sellDate >= a && r.sellDate <= b).map(({ symbol: _s, qty: _q, ...t }) => t);
}

// ---------------------------------------------------------------------------
// F8 Harvesting assistant (tax effects only, no recommendations)
// ---------------------------------------------------------------------------

export interface HarvestCandidate {
  symbol: string;
  buyDate: string;
  qty: number;
  qtyToBook: number;
  gainBooked: number;
  term: 'short' | 'long';
  kind: 'ltcg_harvest' | 'loss_harvest';
  taxEffectNow: number; // change in this year's tax (negative = lower)
  futureTaxAvoided: number; // for LTCG harvest: 12.5% of the step-up in cost
  note: string;
}

export interface HarvestView {
  asOf: string;
  season: boolean; // from January
  realisedEquityLTCG: number;
  exemption: number;
  unusedExemption: number;
  realisedGains: { short: number; long: number };
  candidates: HarvestCandidate[];
  disclaimer: string;
}

export function harvest(profileInput: TaxProfile | TaxProfileInput, lots: Lot[], asOf: string): HarvestView {
  const profile = TaxProfileSchema.parse(profileInput);
  const view = buildPortfolio(lots, asOf, profile.taxYear);
  const base = TaxProfileSchema.parse({ ...profile, capitalGains: [...profile.capitalGains, ...realisedForYear(view, profile.taxYear)] });
  const baseRes = computeTax(base, base.regime, { skipMarginal: true });
  const pack = getPack(profile.taxYear, base.regime);
  const exemption = pack.specialRates.equityLTCG.exemption / 100;
  const realisedEqLT = baseRes.income.capitalGains.equityLTCG;
  let unused = Math.max(0, exemption - realisedEqLT);
  const candidates: HarvestCandidate[] = [];
  const mk = (h: Holding, qty: number) =>
    CapitalGainTxnSchema.parse({ label: `${h.symbol} (harvest)`, assetType: h.assetType, buyDate: h.buyDate, sellDate: asOf, cost: Math.round(qty * h.buyPrice), saleValue: Math.round(qty * (h.currentPrice ?? 0)), sttPaid: true });

  // LTCG harvesting: book long-term equity gains up to the unused exemption.
  const ltGainers = view.holdings
    .filter((h) => h.term === 'long' && (h.unrealised ?? 0) > 0 && ['listed_equity', 'equity_mf'].includes(h.assetType) && h.currentPrice)
    .sort((a, b) => b.unrealised! - a.unrealised!);
  for (const h of ltGainers) {
    if (unused <= 0) break;
    const perUnit = h.currentPrice! - h.buyPrice;
    const qty = Math.min(h.qty, Math.floor(unused / perUnit));
    if (qty <= 0) continue;
    const gainBooked = Math.round(qty * perUnit);
    unused -= gainBooked;
    const t = computeTax({ ...base, capitalGains: [...base.capitalGains, mk(h, qty)] }, base.regime, { skipMarginal: true }).totalTax;
    candidates.push({
      symbol: h.symbol, buyDate: h.buyDate, qty: h.qty, qtyToBook: qty, gainBooked, term: 'long', kind: 'ltcg_harvest',
      taxEffectNow: t - baseRes.totalTax, futureTaxAvoided: Math.round(gainBooked * pack.specialRates.equityLTCG.rate),
      note: `Selling and rebuying ${qty} units books ${'Rs ' + gainBooked.toLocaleString('en-IN')} of long-term gain inside the exemption and resets your cost.`,
    });
  }

  // Loss harvesting: unrealised losses that would offset realised gains this year.
  const hasGains = baseRes.income.capitalGains.equitySTCG + baseRes.income.capitalGains.equityLTCG + baseRes.income.capitalGains.otherLTCG + baseRes.income.capitalGains.slabSTCG > 0;
  if (hasGains) {
    for (const h of view.holdings.filter((x) => (x.unrealised ?? 0) < 0 && x.currentPrice !== null)) {
      const t = computeTax({ ...base, capitalGains: [...base.capitalGains, mk(h, h.qty)] }, base.regime, { skipMarginal: true }).totalTax;
      if (t < baseRes.totalTax) {
        candidates.push({
          symbol: h.symbol, buyDate: h.buyDate, qty: h.qty, qtyToBook: h.qty, gainBooked: h.unrealised!, term: h.term, kind: 'loss_harvest',
          taxEffectNow: t - baseRes.totalTax, futureTaxAvoided: 0,
          note: `${h.term === 'short' ? 'Short-term losses offset any gain' : 'Long-term losses offset only long-term gains'}; booking this loss lowers this year's tax.`,
        });
      }
    }
  }
  const month = Number(asOf.slice(5, 7));
  return {
    asOf, season: month >= 1 && month <= 3, realisedEquityLTCG: realisedEqLT, exemption, unusedExemption: Math.max(0, exemption - realisedEqLT),
    realisedGains: { short: view.totals.realisedST, long: view.totals.realisedLT }, candidates,
    disclaimer: 'FiscAI shows tax effects only. It does not recommend buying or selling any security.',
  };
}
