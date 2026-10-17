import { TaxProfileSchema } from '@fiscai/shared-types';
import { Router } from 'express';
import { z } from 'zod';
import { parse, taxYearParam, today } from '../lib/http';
import { requireAuth, uid } from '../middleware/auth';
import { DeadlineModel, User } from '../models';
import { compare, computeCached } from '../services/tax';
import { getProfile } from '../services/profile';

export const taxRouter = Router();
taxRouter.use(requireAuth);

/** Compute tax for a Tax Year and regime. Optional `profile` overrides the stored one (for previews). */
taxRouter.post('/compute', async (req, res) => {
  const body = parse(z.object({ taxYear: z.enum(['2025-26', '2026-27']), regime: z.enum(['new', 'old']).optional(), profile: z.unknown().optional() }), req.body);
  const stored = await getProfile(uid(req), body.taxYear);
  const profile = body.profile ? parse(TaxProfileSchema, { ...(body.profile as object), taxYear: body.taxYear }) : stored.profile;
  const result = await computeCached(uid(req), profile, body.regime ?? profile.regime);
  res.json({ result, trace: result.trace });
});

taxRouter.get('/compare/:taxYear', async (req, res) => {
  const { profile } = await getProfile(uid(req), taxYearParam(req.params.taxYear));
  res.json(compare(profile));
});

/** Everything the dashboard needs in one call. */
taxRouter.get('/summary/:taxYear', async (req, res) => {
  const userId = uid(req);
  const taxYear = taxYearParam(req.params.taxYear);
  const { profile, version, updatedAt } = await getProfile(userId, taxYear);
  const comparison = compare(profile);
  const chosen = comparison[profile.regime];
  const nextDeadline = await DeadlineModel.findOne({ userId, taxYear, status: 'open', dueDate: { $gte: today() } }).sort({ dueDate: 1 }).lean();
  if (version > 0) await User.updateOne({ _id: userId, 'metrics.firstSummaryAt': { $exists: false } }, { $set: { 'metrics.firstSummaryAt': new Date() } });
  res.json({
    profileVersion: version, updatedAt, regime: profile.regime, result: chosen,
    comparison: { new: comparison.new.totalTax, old: comparison.old.totalTax, recommended: comparison.recommended, savings: comparison.savings },
    nextDeadline,
  });
});
