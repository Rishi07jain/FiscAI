import type { ExtractedField } from '@fiscai/shared-types';
import Papa from 'papaparse';

export type Row = Record<string, unknown>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES: Record<string, string[]> = {
  symbol: ['symbol', 'scrip', 'tradingsymbol', 'stockname', 'scripname', 'instrument', 'security', 'securityname', 'name', 'stock', 'scheme', 'schemename'],
  isin: ['isin', 'isincode'],
  qty: ['quantity', 'qty', 'units', 'noofshares', 'sellquantity', 'totalqty'],
  buyDate: ['buydate', 'entrydate', 'purchasedate', 'dateofpurchase', 'buytradedate', 'dateofacquisition', 'acquisitiondate'],
  sellDate: ['selldate', 'exitdate', 'saledate', 'dateofsale', 'selltradedate', 'dateoftransfer', 'redemptiondate'],
  buyValue: ['buyvalue', 'purchasevalue', 'totalbuyvalue', 'costofacquisition', 'buyamount', 'purchaseamount', 'buycost'],
  sellValue: ['sellvalue', 'salevalue', 'totalsellvalue', 'saleconsideration', 'sellamount', 'fullvalueofconsideration', 'redemptionamount'],
  buyPrice: ['buyprice', 'buyavg', 'avgbuyprice', 'purchaseprice', 'buyrate', 'avgcost', 'averagebuyprice'],
  sellPrice: ['sellprice', 'sellavg', 'avgsellprice', 'saleprice', 'sellrate', 'averagesellprice'],
  pnl: ['realizedpnl', 'realisedpnl', 'pnl', 'profitloss', 'realizedprofit', 'netpnl', 'grosspnl', 'realisedprofitloss', 'realizedprofitloss', 'gainloss', 'shorttermgain', 'longtermgain'],
  segment: ['segment', 'instrumenttype', 'exchsegment', 'producttype', 'product', 'tradetypesegment'],
  date: ['date', 'tradedate', 'orderexecutiontime', 'transactiondate', 'executiondate'],
  side: ['tradetype', 'buysell', 'side', 'transactiontype', 'type', 'action'],
  price: ['price', 'rate', 'tradeprice', 'nav', 'averageprice'],
  charges: ['charges', 'totalcharges', 'brokerage', 'othercharges'],
  stt: ['stt', 'securitiestransactiontax'],
};

function headerMap(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const h of headers) {
    const k = norm(h);
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (!m[field] && aliases.includes(k)) m[field] = h;
    }
  }
  return m;
}

export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[₹,\s]|Rs\.?/gi, '').replace(/^\((.*)\)$/, '-$1');
  if (!s || isNaN(Number(s))) return undefined;
  return Number(s);
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function isoDate(v: unknown): string | undefined {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10); // Excel serial
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]*(\d{2,4})/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return undefined;
}

/** Find the header row in sheets that have a title preamble (e.g. broker tax P&L exports). */
export function rowsFromMatrix(matrix: unknown[][]): Row[] {
  let headerIdx = 0;
  let best = 0;
  for (let i = 0; i < Math.min(matrix.length, 40); i++) {
    const cells = (matrix[i] ?? []).map((c) => (typeof c === 'string' ? c : ''));
    const score = Object.keys(headerMap(cells.filter(Boolean))).length;
    if (score > best) { best = score; headerIdx = i; }
  }
  const headers = (matrix[headerIdx] ?? []).map((c, i) => (typeof c === 'string' && c.trim() ? c.trim() : `col${i}`));
  return matrix.slice(headerIdx + 1).filter((r) => r.some((c) => c !== null && c !== undefined && c !== '')).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

export function parseCsv(text: string): Row[] {
  const res = Papa.parse<unknown[]>(text.trim(), { skipEmptyLines: true, dynamicTyping: false });
  return rowsFromMatrix(res.data as unknown[][]);
}

export async function parseXlsx(buf: Buffer): Promise<Row[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const all: Row[] = [];
  wb.eachSheet((ws) => {
    const matrix: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map((v: any) => (v && typeof v === 'object' && 'result' in v ? v.result : v && typeof v === 'object' && 'text' in v ? v.text : v));
      matrix.push(vals);
    });
    all.push(...rowsFromMatrix(matrix));
  });
  return all;
}

const isFnoSymbol = (s: string) => /(FUT|CE|PE)$/i.test(s.replace(/\s+/g, '')) || /\b(FUT|CE|PE)\b/i.test(s);

/** Deterministic broker P&L / tradebook parser. Returns fields or null if columns are not recognised. */
export function brokerFields(rows: Row[]): ExtractedField[] | null {
  if (!rows.length) return null;
  const map = headerMap(Object.keys(rows[0]));
  const get = (r: Row, f: string) => (map[f] ? r[map[f]] : undefined);
  const fields: ExtractedField[] = [];
  const realised = map.symbol && map.qty && (map.sellDate || map.sellValue || map.sellPrice) && (map.buyDate || map.buyValue || map.buyPrice);
  const tradebook = map.symbol && map.qty && map.side && map.price && map.date;
  const pnlOnly = map.symbol && map.pnl && !realised;
  if (!realised && !tradebook && !pnlOnly) return null;

  rows.forEach((r, i) => {
    const symbol = String(get(r, 'symbol') ?? '').trim();
    if (!symbol || /^total/i.test(symbol)) return;
    const seg = String(get(r, 'segment') ?? '').toLowerCase();
    const ref = `row ${i + 2}`;
    const qty = Math.abs(num(get(r, 'qty')) ?? 0);
    const fno = /f&?o|fut|opt|nfo|deriv/.test(seg) || isFnoSymbol(symbol);
    let intraday = /intraday|mis|speculat/.test(seg);

    if (tradebook && !realised) {
      const side = String(get(r, 'side') ?? '').toLowerCase();
      const date = isoDate(get(r, 'date'));
      const price = num(get(r, 'price'));
      if (!date || price === undefined || !qty) return;
      const lot = side.startsWith('s')
        ? { symbol, isin: get(r, 'isin') as string | undefined, assetType: 'listed_equity', qty, buyDate: date, buyPrice: 0, sellDate: date, sellPrice: price, charges: 0, source: 'broker' }
        : { symbol, isin: get(r, 'isin') as string | undefined, assetType: 'listed_equity', qty, buyDate: date, buyPrice: price, charges: 0, source: 'broker' };
      fields.push({ path: 'lots[]', label: `${side.startsWith('s') ? 'Sell' : 'Buy'} ${qty} ${symbol} @ ${price} on ${date}`, value: lot, confidence: fno ? 0.5 : 0.95, sourceRef: ref });
      return;
    }

    const pnl = num(get(r, 'pnl'));
    const sellDate = isoDate(get(r, 'sellDate')) ?? isoDate(get(r, 'date'));
    const buyDate = isoDate(get(r, 'buyDate'));
    const sellValue = num(get(r, 'sellValue')) ?? (qty && num(get(r, 'sellPrice')) !== undefined ? qty * num(get(r, 'sellPrice'))! : undefined);
    const buyValue = num(get(r, 'buyValue')) ?? (qty && num(get(r, 'buyPrice')) !== undefined ? qty * num(get(r, 'buyPrice'))! : undefined);
    const charges = num(get(r, 'charges'));
    const stt = num(get(r, 'stt'));

    if (!fno && buyDate && sellDate && buyDate === sellDate) intraday = true; // same-day equity = speculative
    if (fno || intraday) {
      const p = pnl ?? (sellValue !== undefined && buyValue !== undefined ? sellValue - buyValue : undefined);
      if (p === undefined) return;
      const segment = intraday && !fno ? 'INTRADAY_EQ' : /CE|PE|opt/i.test(symbol + seg) ? 'OPT' : 'FUT';
      fields.push({
        path: 'fnoTrades[]', label: `${segment} ${symbol}: P&L ${Math.round(p)}`,
        value: { date: sellDate ?? buyDate ?? '', symbol, segment, pnl: p, sellValue: sellValue ?? 0, charges, stt },
        confidence: sellDate ? 0.9 : 0.6, sourceRef: ref,
      });
      return;
    }
    if (!sellDate || sellValue === undefined) return;
    const complete = Boolean(buyDate && buyValue !== undefined && qty);
    fields.push({
      path: 'lots[]', label: `${symbol} × ${qty || '?'}: bought ${buyDate ?? '?'}, sold ${sellDate}`,
      value: {
        symbol, isin: get(r, 'isin') as string | undefined, assetType: /fund|growth|direct|plan/i.test(symbol) ? 'equity_mf' : 'listed_equity',
        qty: qty || 1, buyDate: buyDate ?? sellDate, buyPrice: buyValue !== undefined && qty ? buyValue / qty : 0,
        sellDate, sellPrice: qty ? sellValue / qty : sellValue, charges: charges ?? 0, source: 'broker',
      },
      confidence: complete ? 0.95 : 0.55, sourceRef: ref,
    });
  });
  return fields.length ? fields : null;
}

/** Heuristic walker for the AIS JSON export. */
export function aisJsonFields(json: unknown): ExtractedField[] {
  const out: ExtractedField[] = [];
  const classify = (desc: string): string | null => {
    const d = desc.toLowerCase();
    if (/salary/.test(d)) return 'salary';
    if (/savings/.test(d) && /interest/.test(d)) return 'interest_savings';
    if (/(deposit|term|fd|recurring)/.test(d) && /interest/.test(d)) return 'interest_fd';
    if (/interest/.test(d)) return 'interest_fd';
    if (/dividend/.test(d)) return 'dividend';
    if (/mutual fund|units/.test(d) && /(sale|redemption)/.test(d)) return 'sale_mf';
    if (/(sale|transfer) of (listed )?(securities|shares|equity)/.test(d)) return 'sale_securities';
    if (/virtual digital|vda|crypto/.test(d)) return 'vda_transfer';
    if (/rent/.test(d)) return 'rent_received';
    return null;
  };
  let idx = 0;
  const visit = (node: unknown, ctx: string) => {
    if (Array.isArray(node)) { node.forEach((n) => visit(n, ctx)); return; }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const descKey = Object.keys(o).find((k) => /info(rmation)?(code|desc|category)?|category|description|nature|type/i.test(k) && typeof o[k] === 'string');
    const amtKey = Object.keys(o).find((k) => /^(amount|amt|value|reportedvalue|total.*amount|grossamount)$/i.test(k.replace(/[_\s]/g, '')));
    const srcKey = Object.keys(o).find((k) => /source|reporter|deductor|name/i.test(k) && typeof o[k] === 'string');
    const desc = `${ctx} ${descKey ? String(o[descKey]) : ''}`;
    const cat = classify(desc);
    const amount = amtKey ? num(o[amtKey]) : undefined;
    if (cat && amount !== undefined) {
      const tdsKey = Object.keys(o).find((k) => /tds|taxdeducted/i.test(k.replace(/[_\s]/g, '')));
      out.push({ path: 'aisEntries[]', label: `${cat}: ${srcKey ? o[srcKey] : 'source'} — ${amount}`, value: { category: cat, source: srcKey ? String(o[srcKey]) : '', amount, tds: tdsKey ? num(o[tdsKey]) ?? 0 : 0 }, confidence: 0.8, sourceRef: `item ${++idx}` });
      return;
    }
    for (const [k, v] of Object.entries(o)) visit(v, descKey ? String(o[descKey]) : `${ctx} ${k}`);
  };
  visit(json, '');
  return out;
}
