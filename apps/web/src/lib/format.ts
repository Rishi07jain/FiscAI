export function inr(n: number | null | undefined, opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const neg = n < 0;
  const abs = Math.abs(Math.round(n));
  let body: string;
  if (opts.compact && abs >= 1e7) body = `${(abs / 1e7).toFixed(abs >= 1e8 ? 1 : 2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}Cr`;
  else if (opts.compact && abs >= 1e5) body = `${(abs / 1e5).toFixed(abs >= 1e6 ? 1 : 2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}L`;
  else body = abs.toLocaleString('en-IN');
  const sign = neg ? '−' : opts.sign && n > 0 ? '+' : '';
  return `${sign}₹${body}`;
}

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits).replace(/\.0$/, '')}%`;

export function fmtDate(iso?: string | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', opts);
}

export function daysUntil(iso: string) {
  const a = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00').getTime();
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - a) / 86400000);
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const SCENARIO_LABELS: Record<string, string> = {
  sell_equity: 'Sell stocks / equity MFs',
  sell_property: 'Sell property',
  home_loan: 'Buy a house with a loan',
  salary_change: 'Salary hike or job switch',
  invest_deduction: 'Insurance / NPS / ELSS',
  redeem_sgb: 'Redeem SGBs',
  buyback: 'Tender shares in a buyback',
  switch_regime: 'Switch regime',
};

export const DOC_LABELS: Record<string, string> = {
  form16: 'Form 16',
  ais: 'AIS / TIS',
  broker_pnl: 'Broker P&L / capital gains',
  mf_cas: 'Mutual fund CAS',
  salary_slip: 'Salary slip',
  rent_receipt: 'Rent receipt',
  crypto_statement: 'Crypto statement',
};
