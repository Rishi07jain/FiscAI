/** Date helpers. All dates are ISO YYYY-MM-DD strings, interpreted as UTC calendar dates. */
export const parseDate = (d: string): Date => new Date(`${d}T00:00:00Z`);
export const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);

export function addMonths(d: string, months: number): string {
  const x = parseDate(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, lastDay));
  return fmtDate(x);
}

export function addDays(d: string, days: number): string {
  const x = parseDate(d);
  x.setUTCDate(x.getUTCDate() + days);
  return fmtDate(x);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

/** True if held for MORE than `months` months (the Act's "more than 12/24 months"). */
export function isLongTerm(buyDate: string, sellDate: string, months: number | null): boolean {
  if (months === null) return false;
  return parseDate(sellDate) > parseDate(addMonths(buyDate, months));
}

/** First date on which a sale would count as long-term. */
export function longTermFrom(buyDate: string, months: number): string {
  return addDays(addMonths(buyDate, months), 1);
}

/** Financial/Tax year label ("2026-27") containing a date. */
export function taxYearOf(d: string): string {
  const x = parseDate(d);
  const y = x.getUTCMonth() >= 3 ? x.getUTCFullYear() : x.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** [start, end] ISO dates of a tax year label. */
export function taxYearBounds(taxYear: string): [string, string] {
  const y = Number(taxYear.slice(0, 4));
  return [`${y}-04-01`, `${y + 1}-03-31`];
}

/** Resolve "MM-DD" inside a tax year to a full ISO date (Apr-Dec → first year, Jan-Mar → second). */
export function dateInTaxYear(taxYear: string, mmdd: string): string {
  const y = Number(taxYear.slice(0, 4));
  const m = Number(mmdd.slice(0, 2));
  return `${m >= 4 ? y : y + 1}-${mmdd}`;
}

/** Due-date "MM-DD" for the return of a tax year (filed in the following year). */
export function returnDateFor(taxYear: string, mmdd: string): string {
  const y = Number(taxYear.slice(0, 4)) + 1;
  const m = Number(mmdd.slice(0, 2));
  return `${m >= 4 ? y : y + 1}-${mmdd}`;
}
