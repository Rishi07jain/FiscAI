import { LotSchema, VdaTxnSchema, type ExtractedField } from '@fiscai/shared-types';
import type { Types } from 'mongoose';
import { HttpError } from '../lib/http';
import { AisEntryModel, DocumentModel, FnoTradeModel, LotModel, User } from '../models';
import { syncDeadlines } from './deadlines';
import { getProfile, saveProfile, setPath } from './profile';
import { deleteFile } from './storage';

const NUMERIC_PREFIXES = ['salary.', 'deductions.', 'otherIncome.', 'taxesPaid.', 'business.', 'houseProperty.'];
const TEXT_PATHS = ['salary.employerName', 'salary.landlordRelation', 'salary.landlordPan', 'personal.name', 'personal.pan', 'personal.city'];

/** Apply reviewed fields: scalars into the profile (new version), lists into their collections. */
export async function confirmDocument(userId: Types.ObjectId, docId: string, reviewed: ExtractedField[]) {
  const doc = await DocumentModel.findOne({ _id: docId, userId });
  if (!doc) throw new HttpError(404, 'Document not found');
  if (doc.status !== 'needs_review') throw new HttpError(409, `Document is ${doc.status}`);
  const taxYear = doc.taxYear;
  const accepted = reviewed.filter((f) => f.accepted !== false);
  const { profile } = await getProfile(userId, taxYear);
  const next: any = structuredClone(profile);
  let lots = 0, trades = 0, ais = 0, vda = 0, scalars = 0;
  for (const f of accepted) {
    if (f.path === 'lots[]') {
      const lot = LotSchema.safeParse(f.value);
      if (lot.success) { await LotModel.create({ ...lot.data, userId, source: lot.data.source || doc.type }); lots++; }
    } else if (f.path === 'fnoTrades[]') {
      const v = f.value as any;
      await FnoTradeModel.create({ userId, taxYear, date: v.date, symbol: v.symbol, segment: v.segment, pnl: Number(v.pnl) || 0, sellValue: Number(v.sellValue) || 0, charges: v.charges, stt: v.stt, source: 'broker' });
      trades++;
    } else if (f.path === 'aisEntries[]') {
      const v = f.value as any;
      await AisEntryModel.create({ userId, taxYear, category: v.category, source: v.source, amount: Number(v.amount) || 0, tds: Number(v.tds) || 0, documentId: doc._id });
      ais++;
    } else if (f.path === 'vda[]') {
      const v = VdaTxnSchema.safeParse(f.value);
      if (v.success) { setPath(next, 'vda[]', v.data); vda++; }
    } else if (f.path === 'regime') {
      if (f.value === 'new' || f.value === 'old') { next.regime = f.value; scalars++; }
    } else if (TEXT_PATHS.includes(f.path)) {
      setPath(next, f.path, String(f.value ?? ''));
      scalars++;
    } else if (NUMERIC_PREFIXES.some((p) => f.path.startsWith(p))) {
      const n = Number(f.value);
      if (Number.isFinite(n)) { setPath(next, f.path, Math.round(n)); scalars++; }
    }
  }
  let version: number | undefined;
  if (scalars || vda) version = (await saveProfile(userId, taxYear, next, `document:${doc._id}`)).version;
  doc.extractedFields = reviewed as any;
  doc.status = 'confirmed';
  if (!doc.keepFile) {
    await deleteFile(doc.fileRef);
    doc.fileRef = undefined;
    doc.pagesPreview = [] as any;
    doc.deletedAt = new Date();
  }
  await doc.save();
  await User.updateOne({ _id: userId, 'metrics.firstUploadAt': { $exists: false } }, { $set: { 'metrics.firstUploadAt': new Date() } });
  await syncDeadlines(userId, taxYear);
  return { applied: { scalars, lots, fnoTrades: trades, aisEntries: ais, vda }, profileVersion: version };
}
