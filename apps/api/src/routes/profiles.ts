import { CITY_OPTIONS, IncomeSourceSchema, TaxProfileSchema } from '@fiscai/shared-types';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parse, taxYearParam } from '../lib/http';
import { requireAuth, uid } from '../middleware/auth';
import { User } from '../models';
import { syncDeadlines } from '../services/deadlines';
import { getProfile, getVersion, listVersions, saveProfile } from '../services/profile';

export const profilesRouter = Router();
profilesRouter.use(requireAuth);

profilesRouter.get('/:taxYear', async (req, res) => {
  const r = await getProfile(uid(req), taxYearParam(req.params.taxYear));
  res.json(r);
});

profilesRouter.put('/:taxYear', async (req, res) => {
  const taxYear = taxYearParam(req.params.taxYear);
  const profile = parse(TaxProfileSchema, { ...req.body, taxYear });
  const r = await saveProfile(uid(req), taxYear, profile, 'manual');
  await syncDeadlines(uid(req), taxYear);
  res.json(r);
});

profilesRouter.get('/:taxYear/versions', async (req, res) => {
  res.json({ versions: await listVersions(uid(req), taxYearParam(req.params.taxYear)) });
});

profilesRouter.get('/:taxYear/versions/:version', async (req, res) => {
  const p = await getVersion(uid(req), taxYearParam(req.params.taxYear), Number(req.params.version));
  if (!p) throw new HttpError(404, 'Version not found');
  res.json({ profile: p });
});

profilesRouter.post('/:taxYear/versions/:version/restore', async (req, res) => {
  const taxYear = taxYearParam(req.params.taxYear);
  const p = await getVersion(uid(req), taxYear, Number(req.params.version));
  if (!p) throw new HttpError(404, 'Version not found');
  res.json(await saveProfile(uid(req), taxYear, p, `restore:v${req.params.version}`));
});

/** Five onboarding questions (+ optional manual salary when the user skips the upload). */
const Onboarding = z.object({
  ageBand: z.enum(['below60', '60to79', '80plus']),
  city: z.string().min(1),
  employmentType: z.enum(['salaried', 'self_employed', 'trader', 'retired', 'student', 'none']),
  monthlyRent: z.coerce.number().min(0).default(0),
  incomeSources: z.array(IncomeSourceSchema).min(1),
  residency: z.enum(['resident', 'rnor', 'nri']).default('resident'),
  parentsSenior: z.boolean().default(false),
  manualSalary: z.object({ gross: z.coerce.number().min(0), basic: z.coerce.number().min(0).optional(), hra: z.coerce.number().min(0).optional(), tds: z.coerce.number().min(0).default(0) }).optional(),
});

profilesRouter.post('/:taxYear/onboarding', async (req, res) => {
  const taxYear = taxYearParam(req.params.taxYear);
  const body = parse(Onboarding, req.body);
  const userId = uid(req);
  const { profile } = await getProfile(userId, taxYear);
  const next = structuredClone(profile);
  next.personal = { ...next.personal, ageBand: body.ageBand, city: CITY_OPTIONS.includes(body.city) ? body.city : body.city.trim(), employmentType: body.employmentType, incomeSources: body.incomeSources, residency: body.residency, parentsSenior: body.parentsSenior };
  next.salary.rentPaid = Math.round(body.monthlyRent * 12);
  if (body.manualSalary && body.manualSalary.gross > 0) {
    const m = body.manualSalary;
    const basic = m.basic ?? Math.round(m.gross * 0.4);
    const hra = m.hra ?? 0;
    next.salary = { ...next.salary, basic, hra, specialAllowance: Math.max(0, m.gross - basic - hra), da: 0, otherAllowances: 0, bonus: 0, perquisites: 0 };
    next.taxesPaid.tds = m.tds;
  }
  const r = await saveProfile(userId, taxYear, next, 'onboarding');
  await User.updateOne({ _id: userId }, { $set: { onboardedAt: new Date(), activeTaxYear: taxYear } });
  await syncDeadlines(userId, taxYear);
  res.json(r);
});
