/**
 * Remove personal identifiers before any text is sent to the LLM.
 * PAN, Aadhaar, bank account numbers, IFSC, phone numbers and email addresses.
 */
export function redact(text: string): { text: string; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  const sub = (re: RegExp, label: string) => {
    text = text.replace(re, () => {
      counts[label] = (counts[label] ?? 0) + 1;
      return `[${label}]`;
    });
  };
  sub(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, 'PAN');
  sub(/\b[2-9][0-9]{3}[\s-]?[0-9]{4}[\s-]?[0-9]{4}\b/g, 'AADHAAR');
  sub(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, 'IFSC');
  sub(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, 'EMAIL');
  sub(/(?<![\d,.])(?:\+91[\s-]?)?[6-9]\d{9}(?![\d,.])/g, 'PHONE');
  sub(/(?<![\d,.])\d{11,18}(?![\d,.])/g, 'ACCOUNT');
  sub(/\b[A-Z]{4}[0-9]{5}[A-Z]\b/g, 'TAN');
  return { text, counts };
}
