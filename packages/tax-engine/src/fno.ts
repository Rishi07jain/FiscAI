import { getPack } from './packs';

export interface FnoTrade {
  date: string;
  symbol: string;
  segment: 'FUT' | 'OPT' | 'INTRADAY_EQ';
  pnl: number; // realised profit/loss in rupees (before charges)
  sellValue: number; // futures: sell-side contract value; options: premium on sale
  exercised?: boolean;
  exerciseValue?: number; // settlement value when an option is exercised
  charges?: number; // brokerage, exchange fees, GST, stamp (excluding STT)
  stt?: number; // STT actually charged, if known
}

export interface FnoSummary {
  trades: number;
  fno: { turnover: number; grossPnl: number; charges: number; stt: number; netProfit: number };
  intraday: { turnover: number; grossPnl: number; charges: number; netProfit: number };
  sttImpact: { oldRates: number; newRates: number; increase: number; effectiveFrom: string };
  audit: { required: boolean; reason: string; threshold: number };
  carryForward: { year: string; loss: number; expiresAfter: string }[];
  itrForm: 'ITR-3';
  ruleIds: string[];
}

/**
 * F12: turnover per ICAI guidance (sum of absolute profits and losses for F&O),
 * net profit after charges and STT, audit applicability, Budget 2026 STT impact.
 */
export function summariseFno(trades: FnoTrade[], taxYear = '2026-27', priorLosses: { year: string; loss: number }[] = []): FnoSummary {
  const pack = getPack(taxYear, 'new');
  const { sttOld, sttNew, auditTurnover, effectiveFrom } = pack.fno;
  let fTurn = 0, fPnl = 0, fCh = 0, fStt = 0, iTurn = 0, iPnl = 0, iCh = 0;
  let sttOldTotal = 0, sttNewTotal = 0;
  for (const t of trades) {
    const oldStt = t.segment === 'FUT' ? t.sellValue * sttOld.futures : t.segment === 'OPT' ? (t.exercised ? (t.exerciseValue ?? 0) * sttOld.optionsExercise : t.sellValue * sttOld.optionsPremium) : 0;
    const newStt = t.segment === 'FUT' ? t.sellValue * sttNew.futures : t.segment === 'OPT' ? (t.exercised ? (t.exerciseValue ?? 0) * sttNew.optionsExercise : t.sellValue * sttNew.optionsPremium) : 0;
    sttOldTotal += oldStt;
    sttNewTotal += newStt;
    const stt = t.stt ?? (t.date >= effectiveFrom ? newStt : oldStt);
    if (t.segment === 'INTRADAY_EQ') {
      iTurn += Math.abs(t.pnl);
      iPnl += t.pnl;
      iCh += (t.charges ?? 0) + stt;
    } else {
      fTurn += Math.abs(t.pnl);
      fPnl += t.pnl;
      fCh += t.charges ?? 0;
      fStt += stt;
    }
  }
  const fNet = fPnl - fCh - fStt;
  const threshold = auditTurnover / 100;
  const auditRequired = fTurn > threshold;
  const cf = priorLosses.map((l) => ({ year: l.year, loss: l.loss, expiresAfter: `${Number(l.year.slice(0, 4)) + 8}-${String((Number(l.year.slice(0, 4)) + 9) % 100).padStart(2, '0')}` }));
  if (fNet < 0) cf.push({ year: taxYear, loss: Math.round(-fNet), expiresAfter: `${Number(taxYear.slice(0, 4)) + 8}-${String((Number(taxYear.slice(0, 4)) + 9) % 100).padStart(2, '0')}` });
  return {
    trades: trades.length,
    fno: { turnover: Math.round(fTurn), grossPnl: Math.round(fPnl), charges: Math.round(fCh), stt: Math.round(fStt), netProfit: Math.round(fNet) },
    intraday: { turnover: Math.round(iTurn), grossPnl: Math.round(iPnl), charges: Math.round(iCh), netProfit: Math.round(iPnl - iCh) },
    sttImpact: { oldRates: Math.round(sttOldTotal), newRates: Math.round(sttNewTotal), increase: Math.round(sttNewTotal - sttOldTotal), effectiveFrom },
    audit: {
      required: auditRequired,
      threshold,
      reason: auditRequired
        ? `Turnover Rs ${Math.round(fTurn).toLocaleString('en-IN')} exceeds Rs ${threshold.toLocaleString('en-IN')} (assuming 95%+ digital transactions): tax audit required.`
        : 'Turnover is within the Rs 10 crore limit for digital transactions; no audit unless you opt for presumptive taxation and declare lower profit.',
    },
    carryForward: cf,
    itrForm: 'ITR-3',
    ruleIds: ['FNO-BUSINESS', 'FNO-STT-2026', 'SPEC-INTRADAY'],
  };
}
