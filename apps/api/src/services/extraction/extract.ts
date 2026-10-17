import type { DocumentType, ExtractedField } from '@fiscai/shared-types';
import { z } from 'zod';
import { redact } from '../../lib/redact';
import { llm } from '../llm';
import { pdfPages } from './pdf';
import { SPECS, responseSchemaFor, type DocSpec } from './specs';
import { aisJsonFields, brokerFields, isoDate, num, parseCsv, parseXlsx, type Row } from './tabular';

export const LOW_CONFIDENCE = 0.8;

export interface ExtractionOutput {
  fields: ExtractedField[];
  method: 'deterministic' | 'llm' | 'llm-vision';
  pagesPreview: { ref: string; text: string }[];
  redactions: Record<string, number>;
  warnings: string[];
}

const SYSTEM = `You extract data from Indian tax and financial documents into strict JSON.
Rules:
- Only report values that are present in the document. Never guess or compute totals that are not printed.
- Amounts are plain numbers in rupees without commas or currency symbols.
- Dates are YYYY-MM-DD.
- confidence is 0-1: 0.95+ when the value is printed clearly with an unambiguous label, lower when inferred or the label is ambiguous.
- page is the 1-based page number where the value appears; ref is "page N" or "row N".
- Redacted tokens like [PAN] or [ACCOUNT] are intentional; never try to reconstruct them.`;

const ScalarOut = z.object({ fields: z.array(z.object({ path: z.string(), number: z.number().optional(), text: z.string().optional(), confidence: z.number().min(0).max(1), page: z.number() })) });
const ListOut = z.object({ items: z.array(z.record(z.unknown())) });

async function callLlm(spec: DocSpec, prompt: string, images?: { mimeType: string; data: Buffer }[]) {
  const schema = responseSchemaFor(spec);
  const validator = spec.list ? ListOut : ScalarOut;
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = attempt === 0 ? prompt : `${prompt}\n\nYour previous answer was invalid (${lastErr}). Return JSON that matches the schema exactly.`;
    try {
      const raw = await llm().extractJson({ system: SYSTEM, prompt: p, schema, images });
      const parsed = validator.safeParse(raw);
      if (parsed.success) return parsed.data as z.infer<typeof ScalarOut> & z.infer<typeof ListOut>;
      lastErr = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } catch (e) {
      lastErr = (e as Error).message;
      if (/not configured/.test(lastErr)) throw e;
    }
  }
  throw new Error(`Extraction output failed validation twice (${lastErr}); sent to manual review.`);
}

function scalarFields(spec: DocSpec, out: z.infer<typeof ScalarOut>, type: DocumentType): ExtractedField[] {
  const bySpec = new Map(spec.scalars.map((s) => [s.path, s]));
  const raw = out.fields.filter((f) => bySpec.has(f.path));
  const get = (p: string) => raw.find((f) => f.path === p);
  const fields: ExtractedField[] = [];
  const months = Math.max(1, Math.round(get('meta.monthsCovered')?.number ?? 1));
  for (const f of raw) {
    const s = bySpec.get(f.path)!;
    if (f.path.startsWith('meta.')) continue;
    let value: unknown = s.kind === 'number' ? f.number ?? num(f.text) : f.text ?? (f.number !== undefined ? String(f.number) : undefined);
    if (value === undefined || value === '') continue;
    let label = s.label;
    let confidence = f.confidence;
    if (f.path === 'regime') value = /new|115bac/i.test(String(value)) ? 'new' : 'old';
    if (type === 'salary_slip' && s.kind === 'number') {
      const factor = 12 / months;
      value = Math.round((value as number) * factor);
      label = `${s.label.replace(' (monthly)', '')} — annualised ×${factor}`;
      confidence = Math.min(confidence, 0.85);
    }
    fields.push({ path: f.path, label, value, confidence, sourceRef: `page ${f.page}` });
  }
  if (type === 'rent_receipt') {
    const rent = get('meta.monthlyRent');
    if (rent?.number) {
      fields.unshift({ path: 'salary.rentPaid', label: `Annual rent paid (Rs ${rent.number}/month × 12)`, value: Math.round(rent.number * 12), confidence: Math.min(rent.confidence, months >= 12 ? 0.95 : 0.75), sourceRef: `page ${rent.page}` });
    }
  }
  return fields;
}

function listFields(type: DocumentType, items: Record<string, unknown>[]): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const it of items) {
    const confidence = Number(it.confidence ?? 0.5);
    const ref = String(it.ref ?? '');
    switch (type) {
      case 'ais':
        out.push({ path: 'aisEntries[]', label: `${it.category}: ${it.source ?? ''} — ${it.amount}`, value: { category: it.category, source: it.source ?? '', amount: num(it.amount) ?? 0, tds: num(it.tds) ?? 0 }, confidence, sourceRef: ref });
        break;
      case 'mf_cas': {
        const date = isoDate(it.date);
        const units = Math.abs(num(it.units) ?? 0);
        if (!date || !units) break;
        const price = num(it.price) ?? (num(it.amount) !== undefined ? Math.abs(num(it.amount)!) / units : 0);
        const assetType = it.fundType === 'debt' ? 'debt_mf' : 'equity_mf';
        const value = it.txnType === 'redemption'
          ? { symbol: String(it.scheme), isin: it.isin, assetType, qty: units, buyDate: date, buyPrice: 0, sellDate: date, sellPrice: price, charges: 0, source: 'cas' }
          : { symbol: String(it.scheme), isin: it.isin, assetType, qty: units, buyDate: date, buyPrice: price, charges: 0, source: 'cas' };
        out.push({ path: 'lots[]', label: `${it.txnType === 'redemption' ? 'Redeem' : 'Buy'} ${units} units ${it.scheme} on ${date}`, value, confidence, sourceRef: ref });
        break;
      }
      case 'broker_pnl': {
        if (it.kind === 'fno' || it.kind === 'intraday') {
          out.push({ path: 'fnoTrades[]', label: `${it.segment ?? 'FNO'} ${it.symbol}: P&L ${it.pnl}`, value: { date: isoDate(it.sellDate) ?? isoDate(it.buyDate) ?? '', symbol: it.symbol, segment: it.kind === 'intraday' ? 'INTRADAY_EQ' : it.segment === 'OPT' ? 'OPT' : 'FUT', pnl: num(it.pnl) ?? 0, sellValue: num(it.sellValue) ?? 0, charges: num(it.charges) }, confidence, sourceRef: ref });
        } else {
          const qty = num(it.qty) ?? 1;
          const sellDate = isoDate(it.sellDate);
          if (!sellDate) break;
          out.push({ path: 'lots[]', label: `${it.symbol} × ${qty}: bought ${it.buyDate}, sold ${sellDate}`, value: { symbol: it.symbol, isin: it.isin, assetType: 'listed_equity', qty, buyDate: isoDate(it.buyDate) ?? sellDate, buyPrice: (num(it.buyValue) ?? 0) / qty, sellDate, sellPrice: (num(it.sellValue) ?? 0) / qty, charges: num(it.charges) ?? 0, source: 'broker' }, confidence, sourceRef: ref });
        }
        break;
      }
      case 'crypto_statement':
        out.push({ path: 'vda[]', label: `${it.asset}: sold for ${it.saleValue}`, value: { label: String(it.asset), asset: String(it.asset), buyDate: isoDate(it.buyDate), sellDate: isoDate(it.sellDate), cost: num(it.cost) ?? 0, saleValue: num(it.saleValue) ?? 0, tdsDeducted: num(it.tdsDeducted) ?? 0 }, confidence, sourceRef: ref });
        break;
    }
  }
  return out;
}

/** Turn AIS rows into suggested profile fields (shown for review, lower confidence). */
function aisSuggestions(fields: ExtractedField[]): ExtractedField[] {
  const sum = (cat: string) => fields.filter((f) => (f.value as any)?.category === cat).reduce((s, f) => s + Number((f.value as any).amount || 0), 0);
  const out: ExtractedField[] = [];
  const add = (path: string, label: string, cat: string) => { const v = sum(cat); if (v) out.push({ path, label: `${label} (sum of AIS rows)`, value: Math.round(v), confidence: 0.75, sourceRef: 'AIS total' }); };
  add('otherIncome.savingsInterest', 'Savings interest', 'interest_savings');
  add('otherIncome.fdInterest', 'Deposit interest', 'interest_fd');
  add('otherIncome.dividends', 'Dividends', 'dividend');
  return out;
}

function rowPreview(rows: Row[]) {
  return rows.slice(0, 200).map((r, i) => ({ ref: `row ${i + 2}`, text: Object.entries(r).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${v instanceof Date ? v.toISOString().slice(0, 10) : v}`).join(' · ').slice(0, 400) }));
}

export async function extractDocument(type: DocumentType, file: { buffer: Buffer; mimeType: string; filename: string }, password?: string): Promise<ExtractionOutput> {
  const spec = SPECS[type];
  const name = file.filename.toLowerCase();
  const warnings: string[] = [];
  const isCsv = file.mimeType.includes('csv') || name.endsWith('.csv');
  const isXlsx = name.endsWith('.xlsx') || file.mimeType.includes('spreadsheetml');
  const isJson = file.mimeType.includes('json') || name.endsWith('.json');
  const isPdf = file.mimeType === 'application/pdf' || name.endsWith('.pdf');
  const isImage = file.mimeType.startsWith('image/');

  // Tabular files: deterministic first, LLM fallback on redacted text.
  if (isCsv || isXlsx) {
    const rows = isCsv ? parseCsv(file.buffer.toString('utf8')) : await parseXlsx(file.buffer);
    const preview = rowPreview(rows).map((p) => ({ ...p, text: redact(p.text).text }));
    const det = type === 'broker_pnl' || type === 'mf_cas' || type === 'crypto_statement' ? brokerFields(rows) : null;
    if (det) return { fields: det, method: 'deterministic', pagesPreview: preview, redactions: {}, warnings };
    const text = preview.map((p) => `${p.ref}: ${p.text}`).join('\n').slice(0, 80000);
    const out = await callLlm(spec, `${spec.instructions}\n\nDocument type: ${spec.title}\nRows:\n${text}`);
    return { fields: spec.list ? listFields(type, out.items) : scalarFields(spec, out, type), method: 'llm', pagesPreview: preview, redactions: {}, warnings };
  }

  if (isJson) {
    let json: unknown;
    try { json = JSON.parse(file.buffer.toString('utf8')); } catch { throw new Error('The JSON file could not be parsed.'); }
    if (type === 'ais') {
      const det = aisJsonFields(json);
      if (det.length) return { fields: [...det, ...aisSuggestions(det)], method: 'deterministic', pagesPreview: [], redactions: {}, warnings };
    }
    const r = redact(JSON.stringify(json).slice(0, 80000));
    const out = await callLlm(spec, `${spec.instructions}\n\nDocument type: ${spec.title}\nJSON:\n${r.text}`);
    const fields = spec.list ? listFields(type, out.items) : scalarFields(spec, out, type);
    return { fields: type === 'ais' ? [...fields, ...aisSuggestions(fields)] : fields, method: 'llm', pagesPreview: [], redactions: r.counts, warnings };
  }

  if (isPdf) {
    const pages = await pdfPages(file.buffer, password);
    const redactions: Record<string, number> = {};
    const red = pages.map((p) => {
      const r = redact(p);
      for (const [k, v] of Object.entries(r.counts)) redactions[k] = (redactions[k] ?? 0) + v;
      return r.text;
    });
    const preview = red.map((t, i) => ({ ref: `page ${i + 1}`, text: t.slice(0, 2500) }));
    const hasText = red.join('').replace(/\s/g, '').length > 50;
    let out;
    let method: ExtractionOutput['method'] = 'llm';
    if (hasText) {
      const body = red.map((t, i) => `=== Page ${i + 1} ===\n${t}`).join('\n\n').slice(0, 120000);
      out = await callLlm(spec, `${spec.instructions}\n\nDocument type: ${spec.title}\n\n${body}`);
    } else {
      warnings.push('Scanned PDF: sent as an image, so identifiers could not be redacted first.');
      method = 'llm-vision';
      out = await callLlm(spec, `${spec.instructions}\n\nDocument type: ${spec.title}. The document is attached.`, [{ mimeType: 'application/pdf', data: file.buffer }]);
    }
    const fields = spec.list ? listFields(type, out.items) : scalarFields(spec, out, type);
    return { fields: type === 'ais' ? [...fields, ...aisSuggestions(fields)] : fields, method, pagesPreview: preview, redactions, warnings };
  }

  if (isImage) {
    warnings.push('Images are sent to the extraction model as-is; identifiers in the image cannot be redacted first.');
    const out = await callLlm(spec, `${spec.instructions}\n\nDocument type: ${spec.title}. The document image is attached; use page 1.`, [{ mimeType: file.mimeType, data: file.buffer }]);
    return { fields: spec.list ? listFields(type, out.items) : scalarFields(spec, out, type), method: 'llm-vision', pagesPreview: [], redactions: {}, warnings };
  }
  throw new Error(`Unsupported file type: ${file.mimeType}`);
}
