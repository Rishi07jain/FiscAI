/** Money helpers. Engine-internal amounts are integer paise. */
export type Paise = number;

export const toPaise = (rupees: number | undefined | null): Paise => Math.round((Number(rupees) || 0) * 100);
export const toRupees = (paise: Paise): number => Math.round(paise / 100);
export const mul = (paise: Paise, rate: number): Paise => Math.round(paise * rate);
export const clamp0 = (p: Paise): Paise => (p > 0 ? p : 0);
export const min = (...xs: Paise[]): Paise => Math.min(...xs);

/** Round to the nearest multiple of `step` paise (Sec 288A/288B: nearest Rs 10). */
export function roundTo(paise: Paise, step: Paise): Paise {
  if (!step) return paise;
  return Math.round(paise / step) * step;
}

export function formatINR(rupees: number): string {
  const neg = rupees < 0;
  const s = Math.abs(Math.round(rupees)).toString();
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}Rs ${rest ? rest + ',' : ''}${last3}`;
}
