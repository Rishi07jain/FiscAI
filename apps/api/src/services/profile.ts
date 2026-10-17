import { TaxProfileSchema, type TaxProfile, type TaxYear } from '@fiscai/shared-types';
import type { Types } from 'mongoose';
import { decryptProfile, encryptProfile } from '../lib/crypto';
import { ProfileVersion, TaxProfileModel } from '../models';

export interface StoredProfile { profile: TaxProfile; version: number; updatedAt?: Date }

export async function getProfile(userId: Types.ObjectId, taxYear: TaxYear | string): Promise<StoredProfile> {
  const doc = await TaxProfileModel.findOne({ userId, taxYear }).lean();
  if (!doc) return { profile: TaxProfileSchema.parse({ taxYear }), version: 0 };
  return { profile: TaxProfileSchema.parse(decryptProfile(doc.data)), version: doc.version ?? 1, updatedAt: doc.updatedAt };
}

function diffPaths(a: any, b: any, prefix = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) || Array.isArray(b)) return [prefix || '(root)'];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k));
}

/** Save a new version of the profile. Every confirmed change is versioned. */
export async function saveProfile(userId: Types.ObjectId, taxYear: string, next: unknown, source = 'manual'): Promise<StoredProfile> {
  const profile = TaxProfileSchema.parse({ ...(next as object), taxYear });
  const current = await getProfile(userId, taxYear);
  const changed = diffPaths(current.profile, profile);
  if (current.version > 0 && changed.length === 0) return current;
  const version = current.version + 1;
  const data = encryptProfile(profile);
  await TaxProfileModel.updateOne({ userId, taxYear }, { $set: { data, version } }, { upsert: true });
  await ProfileVersion.create({ userId, taxYear, version, data, source, changedPaths: changed.slice(0, 200) });
  return { profile, version };
}

export async function listVersions(userId: Types.ObjectId, taxYear: string) {
  return ProfileVersion.find({ userId, taxYear }, { data: 0 }).sort({ version: -1 }).limit(100).lean();
}

export async function getVersion(userId: Types.ObjectId, taxYear: string, version: number) {
  const v = await ProfileVersion.findOne({ userId, taxYear, version }).lean();
  return v ? TaxProfileSchema.parse(decryptProfile(v.data)) : null;
}

/** Set a value at a dot path ("salary.basic") or push to an array path ("capitalGains[]"). */
export function setPath(obj: any, path: string, value: unknown) {
  if (path.endsWith('[]')) {
    const key = path.slice(0, -2);
    const parts = key.split('.');
    let cur = obj;
    for (const p of parts.slice(0, -1)) cur = cur[p] ??= {};
    const last = parts[parts.length - 1];
    (cur[last] ??= []).push(value);
    return;
  }
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) cur = cur[p] ??= {};
  cur[parts[parts.length - 1]] = value;
}
