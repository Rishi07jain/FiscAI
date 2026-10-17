import { TaxProfileSchema, type TaxProfile } from '@fiscai/shared-types';
import { compareRegimes, computeTax, getPack, type TaxResult } from '@fiscai/tax-engine';
import type { Types } from 'mongoose';
import { sha256 } from '../lib/crypto';
import { ComputationModel } from '../models';

/** Compute tax with a cache keyed on (profile, pack). The engine itself is pure. */
export async function computeCached(userId: Types.ObjectId, profile: TaxProfile, regime: 'new' | 'old'): Promise<TaxResult> {
  const pack = getPack(profile.taxYear, regime);
  const profileHash = sha256(JSON.stringify(TaxProfileSchema.parse(profile)) + pack.id);
  const hit = await ComputationModel.findOne({ userId, profileHash, packId: pack.id }).lean();
  if (hit) return hit.result as TaxResult;
  const result = computeTax(profile, pack);
  await ComputationModel.create({ userId, profileHash, packId: pack.id, result, trace: result.trace }).catch(() => undefined);
  return result;
}

export function compare(profile: TaxProfile) {
  return compareRegimes(profile);
}
