import type { CapitalGainTxn } from '@fiscai/shared-types';
import { isLongTerm, taxYearOf } from './dates';
import { clamp0, mul, toPaise, type Paise } from './money';
import { ciiFor, type RulePack } from './packs';

/** Where a gain lands for rate purposes. */
export type CGBucket =
  | 'slabSTCG' // short-term, taxed at slab rates
  | 'equitySTCG' // 111A, 20%
  | 'equityLTCG' // 112A, 12.5% above exemption
  | 'otherLTCG' // 112, 12.5% without indexation
  | 'indexedLTCG' // 112 proviso, 20% with indexation (pre-23-Jul-2024 land/building)
  | 'promoterBuyback' // buyback gains of promoters
  | 'exempt';

export const SPECIAL_BUCKETS = ['equitySTCG', 'equityLTCG', 'otherLTCG', 'indexedLTCG', 'promoterBuyback'] as const;
export type SpecialBucket = (typeof SPECIAL_BUCKETS)[number];

export interface ClassifiedTxn {
  id?: string;
  label: string;
  assetType: string;
  term: 'short' | 'long';
  bucket: CGBucket;
  holdingDays: number;
  /** Gain after exemptions in the chosen method (negative = loss). Paise. */
  gain: Paise;
  saleValue: Paise;
  costBasis: Paise;
  exemptions: { sec54: Paise; sec54F: Paise; sec54EC: Paise };
  indexation?: {
    ciiBuy: number;
    ciiSell: number;
    provisional: boolean;
    indexedCost: Paise;
    gainIndexed: Paise;
    gainUnindexed: Paise;
    taxIndexed: Paise;
    taxUnindexed: Paise;
    chosen: 'indexed' | 'unindexed';
  };
  /** Amount re-classified as dividend income (deemed-dividend buyback regime). */
  deemedDividend?: Paise;
  ruleIds: string[];
  notes: string[];
}

function holdingMonthsFor(pack: RulePack, txn: CapitalGainTxn): number | null {
  if (txn.assetType === 'listed_equity' && !txn.sttPaid) return 12;
  const v = pack.holdingPeriods[txn.assetType];
  return v === undefined ? 24 : v;
}

function applyExemptions(
  pack: RulePack,
  txn: CapitalGainTxn,
  gain: Paise,
  netConsideration: Paise,
): { net: Paise; sec54: Paise; sec54F: Paise; sec54EC: Paise } {
  let remaining = gain;
  let sec54 = 0;
  let sec54F = 0;
  let sec54EC = 0;
  if (remaining <= 0) return { net: remaining, sec54, sec54F, sec54EC };
  const ex = pack.capitalGainsExemptions;
  const isLandBuilding = txn.assetType === 'property' || txn.assetType === 'land';
  if (isLandBuilding && txn.isResidentialHouse && txn.reinvest.sec54 > 0) {
    sec54 = Math.min(remaining, toPaise(txn.reinvest.sec54), ex.sec54.cap);
    remaining -= sec54;
  }
  if (isLandBuilding && txn.reinvest.sec54EC > 0 && remaining > 0) {
    sec54EC = Math.min(remaining, toPaise(txn.reinvest.sec54EC), ex.sec54EC.cap);
    remaining -= sec54EC;
  }
  if (!(isLandBuilding && txn.isResidentialHouse) && txn.reinvest.sec54F > 0 && remaining > 0 && netConsideration > 0) {
    const ratio = Math.min(1, toPaise(txn.reinvest.sec54F) / netConsideration);
    sec54F = Math.min(remaining, Math.round(gain * ratio), ex.sec54F.cap);
    remaining -= sec54F;
  }
  return { net: remaining, sec54, sec54F, sec54EC };
}

export function classifyTxn(pack: RulePack, txn: CapitalGainTxn, residentIndividual = true): ClassifiedTxn {
  const months = holdingMonthsFor(pack, txn);
  const long = isLongTerm(txn.buyDate, txn.sellDate, months);
  const holdingDays = Math.round((Date.parse(txn.sellDate) - Date.parse(txn.buyDate)) / 86400000);
  const sale = toPaise(txn.saleValue);
  const expenses = toPaise(txn.expenses);
  const improvements = txn.improvements.reduce((s, i) => s + toPaise(i.amount), 0);
  const cost = toPaise(txn.cost) + improvements;
  const netConsideration = sale - expenses;
  const rawGain = netConsideration - cost;
  const base: ClassifiedTxn = {
    id: txn.id,
    label: txn.label || txn.assetType,
    assetType: txn.assetType,
    term: long ? 'long' : 'short',
    bucket: 'slabSTCG',
    holdingDays,
    gain: rawGain,
    saleValue: sale,
    costBasis: cost,
    exemptions: { sec54: 0, sec54F: 0, sec54EC: 0 },
    ruleIds: [],
    notes: [],
  };

  switch (txn.assetType) {
    case 'listed_equity':
    case 'equity_mf': {
      if (txn.sttPaid) {
        base.bucket = long ? 'equityLTCG' : 'equitySTCG';
        base.ruleIds.push(long ? 'CG-EQ-LTCG' : 'CG-EQ-STCG');
      } else {
        base.bucket = long ? 'otherLTCG' : 'slabSTCG';
        base.ruleIds.push(long ? 'CG-OTHER-LTCG' : 'CG-OTHER-LTCG');
        base.notes.push('No STT paid: 111A/112A rates do not apply.');
      }
      break;
    }
    case 'debt_mf': {
      base.term = 'short';
      base.bucket = 'slabSTCG';
      base.ruleIds.push('CG-OTHER-LTCG');
      base.notes.push('Debt mutual funds bought after 1 Apr 2023 are always short-term (slab rate).');
      break;
    }
    case 'sgb': {
      base.ruleIds.push('CG-SGB');
      if (txn.sgbRoute === 'original_issue_held_to_maturity') {
        base.bucket = 'exempt';
        base.notes.push('Bought at original issue and redeemed at maturity: exempt.');
      } else if (txn.sgbRoute === 'secondary_market' && pack.taxYear < '2026-27') {
        base.bucket = 'exempt';
        base.notes.push('Redemption by an individual was exempt before Tax Year 2026-27 regardless of purchase route.');
      } else {
        base.bucket = long ? 'otherLTCG' : 'slabSTCG';
        base.notes.push(
          txn.sgbRoute === 'secondary_market'
            ? 'Budget 2026: bought on the secondary market, so redemption is taxable.'
            : 'Sold on the exchange: taxable as capital gains.',
        );
      }
      break;
    }
    case 'buyback': {
      base.ruleIds.push('CG-BUYBACK');
      if (pack.buybackTreatment === 'deemed_dividend') {
        // 1 Oct 2024 – 31 Mar 2026: proceeds taxed as dividend; cost becomes a capital loss.
        base.deemedDividend = sale;
        base.gain = -cost;
        base.bucket = long ? 'otherLTCG' : 'slabSTCG';
        base.notes.push('Buyback proceeds taxed as deemed dividend; the cost of shares is a capital loss.');
      } else if (txn.promoter) {
        base.bucket = 'promoterBuyback';
        base.notes.push('Promoter buyback: higher effective rate applies.');
      } else {
        base.bucket = long ? 'equityLTCG' : 'equitySTCG';
        base.ruleIds.push(long ? 'CG-EQ-LTCG' : 'CG-EQ-STCG');
        base.notes.push('Budget 2026: buyback proceeds taxed as capital gains.');
      }
      break;
    }
    case 'property':
    case 'land': {
      if (!long) {
        base.bucket = 'slabSTCG';
        base.ruleIds.push('CG-OTHER-LTCG');
        break;
      }
      const gf = pack.specialRates.propertyGrandfather;
      const ex1 = applyExemptions(pack, txn, rawGain, netConsideration);
      base.ruleIds.push('CG-OTHER-LTCG');
      if (ex1.sec54) base.ruleIds.push('CG-54');
      if (ex1.sec54EC) base.ruleIds.push('CG-54EC');
      if (ex1.sec54F) base.ruleIds.push('CG-54F');
      if (txn.buyDate < gf.cutoffDate && residentIndividual) {
        const buyCii = ciiFor(pack, taxYearOf(txn.buyDate));
        const sellCii = ciiFor(pack, taxYearOf(txn.sellDate));
        const indexedCost =
          Math.round((toPaise(txn.cost) * sellCii.value) / buyCii.value) +
          txn.improvements.reduce((s, i) => s + Math.round((toPaise(i.amount) * sellCii.value) / ciiFor(pack, taxYearOf(i.date)).value), 0);
        const gainIdx = netConsideration - indexedCost;
        const ex2 = applyExemptions(pack, txn, gainIdx, netConsideration);
        const taxUn = mul(clamp0(ex1.net), pack.specialRates.otherLTCG.rate);
        const taxIdx = mul(clamp0(ex2.net), gf.indexedRate);
        const chooseIndexed = taxIdx < taxUn;
        base.indexation = {
          ciiBuy: buyCii.value,
          ciiSell: sellCii.value,
          provisional: buyCii.provisional || sellCii.provisional,
          indexedCost,
          gainIndexed: ex2.net,
          gainUnindexed: ex1.net,
          taxIndexed: taxIdx,
          taxUnindexed: taxUn,
          chosen: chooseIndexed ? 'indexed' : 'unindexed',
        };
        base.ruleIds.push('CG-PROP-INDEX');
        if (chooseIndexed && ex2.net > 0) {
          base.bucket = 'indexedLTCG';
          base.gain = ex2.net;
          base.exemptions = { sec54: ex2.sec54, sec54F: ex2.sec54F, sec54EC: ex2.sec54EC };
        } else {
          base.bucket = 'otherLTCG';
          base.gain = ex1.net;
          base.exemptions = { sec54: ex1.sec54, sec54F: ex1.sec54F, sec54EC: ex1.sec54EC };
        }
        if (sellCii.provisional) base.notes.push(`CII for ${taxYearOf(txn.sellDate)} is provisional until notified.`);
      } else {
        base.bucket = 'otherLTCG';
        base.gain = ex1.net;
        base.exemptions = { sec54: ex1.sec54, sec54F: ex1.sec54F, sec54EC: ex1.sec54EC };
      }
      return base;
    }
    default: {
      base.bucket = long ? 'otherLTCG' : 'slabSTCG';
      base.ruleIds.push('CG-OTHER-LTCG');
    }
  }

  if (long && base.bucket !== 'exempt' && base.gain > 0) {
    const ex = applyExemptions(pack, txn, base.gain, netConsideration);
    if (ex.sec54F) base.ruleIds.push('CG-54F');
    base.exemptions = { sec54: ex.sec54, sec54F: ex.sec54F, sec54EC: ex.sec54EC };
    base.gain = ex.net;
  }
  if (base.bucket === 'exempt') base.gain = 0;
  return base;
}

export interface CGBuckets {
  slabSTCG: Paise;
  equitySTCG: Paise;
  equityLTCG: Paise;
  otherLTCG: Paise;
  indexedLTCG: Paise;
  promoterBuyback: Paise;
}

export const emptyBuckets = (): CGBuckets => ({ slabSTCG: 0, equitySTCG: 0, equityLTCG: 0, otherLTCG: 0, indexedLTCG: 0, promoterBuyback: 0 });

export interface SetOffResult {
  buckets: CGBuckets;
  stclUsed: Paise;
  ltclUsed: Paise;
  bfStclUsed: Paise;
  bfLtclUsed: Paise;
  stclCarryForward: Paise;
  ltclCarryForward: Paise;
}

const ST_LOSS_ORDER: (keyof CGBuckets)[] = ['slabSTCG', 'equitySTCG', 'promoterBuyback', 'indexedLTCG', 'otherLTCG', 'equityLTCG'];
const LT_LOSS_ORDER: (keyof CGBuckets)[] = ['indexedLTCG', 'otherLTCG', 'equityLTCG'];

function absorb(buckets: CGBuckets, loss: Paise, order: (keyof CGBuckets)[]): Paise {
  let left = loss;
  for (const k of order) {
    if (left <= 0) break;
    const take = Math.min(buckets[k], left);
    buckets[k] -= take;
    left -= take;
  }
  return left;
}

/**
 * Aggregate classified transactions into buckets and apply capital-loss set-off:
 * short-term losses against any gain, long-term losses only against long-term gains;
 * current-year losses first, then brought-forward.
 */
export function aggregateAndSetOff(txns: ClassifiedTxn[], bfStcl: Paise, bfLtcl: Paise): SetOffResult {
  const buckets = emptyBuckets();
  let stcl = 0;
  let ltcl = 0;
  for (const t of txns) {
    if (t.bucket === 'exempt') continue;
    if (t.gain >= 0) buckets[t.bucket as keyof CGBuckets] += t.gain;
    else if (t.term === 'short') stcl += -t.gain;
    else ltcl += -t.gain;
  }
  const stLeft = absorb(buckets, stcl, ST_LOSS_ORDER);
  const ltLeft = absorb(buckets, ltcl, LT_LOSS_ORDER);
  const bfStLeft = absorb(buckets, bfStcl, ST_LOSS_ORDER);
  const bfLtLeft = absorb(buckets, bfLtcl, LT_LOSS_ORDER);
  return {
    buckets,
    stclUsed: stcl - stLeft,
    ltclUsed: ltcl - ltLeft,
    bfStclUsed: bfStcl - bfStLeft,
    bfLtclUsed: bfLtcl - bfLtLeft,
    stclCarryForward: stLeft + bfStLeft,
    ltclCarryForward: ltLeft + bfLtLeft,
  };
}
