import { ScenarioTypeSchema } from '@fiscai/shared-types';
import { runScenario } from '@fiscai/tax-engine';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError, notFound, parse } from '../lib/http';
import { requireAuth, uid } from '../middleware/auth';
import { ScenarioModel, User } from '../models';
import { addScenarioDeadlines, syncDeadlines } from '../services/deadlines';
import { getProfile, saveProfile } from '../services/profile';

export const scenariosRouter = Router();
scenariosRouter.use(requireAuth);

const strip = (r: ReturnType<typeof runScenario>) => {
  const { afterProfile: _a, beforeResult, afterResult, ...rest } = r;
  return { ...rest, beforeResult, afterResult };
};

/** Run (and optionally save) a scenario. The stored profile is never changed here. */
scenariosRouter.post('/', async (req, res) => {
  const userId = uid(req);
  const body = parse(z.object({ taxYear: z.enum(['2025-26', '2026-27']), type: ScenarioTypeSchema, inputs: z.record(z.unknown()), name: z.string().max(120).optional(), save: z.boolean().default(false) }), req.body);
  const { profile, version } = await getProfile(userId, body.taxYear);
  const result = runScenario(profile, body.type, body.inputs);
  await User.updateOne({ _id: userId }, { $inc: { 'metrics.scenariosRun': 1 } });
  if (!body.save) return res.json({ result: strip(result) });
  const doc = await ScenarioModel.create({
    userId, taxYear: body.taxYear, baseProfileVersion: version, name: body.name || body.type.replace(/_/g, ' '), type: body.type, inputs: body.inputs,
    resultSnapshot: strip(result), afterProfile: result.afterProfile,
  });
  res.status(201).json({ scenario: { id: String(doc._id), name: doc.name, type: doc.type, savedAt: doc.savedAt }, result: strip(result) });
});

scenariosRouter.get('/', async (req, res) => {
  const q: Record<string, unknown> = { userId: uid(req) };
  if (req.query.taxYear) q.taxYear = String(req.query.taxYear);
  const list = await ScenarioModel.find(q, { afterProfile: 0 }).sort({ savedAt: -1 }).lean();
  res.json({ scenarios: list.map((s) => ({ id: String(s._id), name: s.name, type: s.type, taxYear: s.taxYear, inputs: s.inputs, baseProfileVersion: s.baseProfileVersion, savedAt: s.savedAt, appliedAt: s.appliedAt, result: s.resultSnapshot })) });
});

scenariosRouter.get('/:id', async (req, res) => {
  const s = await ScenarioModel.findOne({ _id: req.params.id, userId: uid(req) }, { afterProfile: 0 }).lean();
  if (!s) throw notFound('Scenario');
  res.json({ scenario: { id: String(s._id), name: s.name, type: s.type, taxYear: s.taxYear, inputs: s.inputs, baseProfileVersion: s.baseProfileVersion, savedAt: s.savedAt, appliedAt: s.appliedAt, result: s.resultSnapshot } });
});

/** Apply a scenario's changes to the profile (new version), and create its deadlines. */
scenariosRouter.post('/:id/apply', async (req, res) => {
  const userId = uid(req);
  const s = await ScenarioModel.findOne({ _id: req.params.id, userId });
  if (!s) throw notFound('Scenario');
  if (s.appliedAt) throw new HttpError(409, 'Scenario already applied');
  const { version } = await getProfile(userId, s.taxYear!);
  const force = req.query.force === 'true';
  if (version !== s.baseProfileVersion && !force) throw new HttpError(409, `Your profile changed since this scenario was saved (v${s.baseProfileVersion} → v${version}). Re-run it, or apply anyway with ?force=true.`);
  const r = await saveProfile(userId, s.taxYear!, s.afterProfile, `scenario:${s._id}`);
  const snap = s.resultSnapshot as any;
  if (snap?.deadlines?.length) await addScenarioDeadlines(userId, s.taxYear!, String(s._id), snap.deadlines);
  if (snap?.delta < 0) await User.updateOne({ _id: userId }, { $inc: { 'metrics.taxSavedEstimate': -snap.delta } });
  s.appliedAt = new Date();
  await s.save();
  await syncDeadlines(userId, s.taxYear!);
  res.json({ applied: true, profileVersion: r.version });
});

scenariosRouter.delete('/:id', async (req, res) => {
  const r = await ScenarioModel.deleteOne({ _id: req.params.id, userId: uid(req) });
  if (!r.deletedCount) throw notFound('Scenario');
  res.json({ deleted: true });
});
