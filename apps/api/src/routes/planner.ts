import { advanceTaxPlan, deductionFinder } from '@fiscai/tax-engine';
import { Router } from 'express';
import { z } from 'zod';
import { notFound, parse, taxYearParam, today } from '../lib/http';
import { requireAuth, uid } from '../middleware/auth';
import { DeadlineModel } from '../models';
import { syncDeadlines } from '../services/deadlines';
import { getProfile, saveProfile } from '../services/profile';
import { reminderDates } from '@fiscai/tax-engine';

export const plannerRouter = Router();
plannerRouter.use(['/advance-tax', '/deadlines', '/deductions'], requireAuth);

plannerRouter.get('/advance-tax/:taxYear', async (req, res) => {
  const { profile } = await getProfile(uid(req), taxYearParam(req.params.taxYear));
  res.json(advanceTaxPlan(profile, typeof req.query.asOf === 'string' ? req.query.asOf : today()));
});

plannerRouter.post('/advance-tax/:taxYear/payments', async (req, res) => {
  const taxYear = taxYearParam(req.params.taxYear);
  const p = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: z.coerce.number().positive() }), req.body);
  const { profile } = await getProfile(uid(req), taxYear);
  profile.taxesPaid.advancePayments.push(p);
  const r = await saveProfile(uid(req), taxYear, profile, 'advance-tax-payment');
  await syncDeadlines(uid(req), taxYear);
  res.json({ profileVersion: r.version, plan: advanceTaxPlan(r.profile, today()) });
});

plannerRouter.delete('/advance-tax/:taxYear/payments/:index', async (req, res) => {
  const taxYear = taxYearParam(req.params.taxYear);
  const { profile } = await getProfile(uid(req), taxYear);
  profile.taxesPaid.advancePayments.splice(Number(req.params.index), 1);
  const r = await saveProfile(uid(req), taxYear, profile, 'advance-tax-payment');
  res.json({ profileVersion: r.version });
});

plannerRouter.get('/deadlines', async (req, res) => {
  const userId = uid(req);
  const taxYear = taxYearParam(req.query.taxYear ?? '2026-27');
  await syncDeadlines(userId, taxYear);
  const list = await DeadlineModel.find({ userId, taxYear }).sort({ dueDate: 1 }).lean();
  res.json({ deadlines: list.map((d) => ({ ...d, id: String(d._id) })), today: today() });
});

plannerRouter.post('/deadlines', async (req, res) => {
  const body = parse(z.object({ taxYear: z.string(), title: z.string().min(1).max(160), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.body);
  const d = await DeadlineModel.create({ userId: uid(req), taxYear: body.taxYear, key: `custom:${Date.now()}:${Math.random().toString(36).slice(2)}`, type: 'custom', title: body.title, dueDate: body.dueDate, origin: 'custom', remindAt: reminderDates(body.dueDate), remindersSent: [] });
  res.status(201).json({ deadline: { ...d.toObject(), id: String(d._id) } });
});

plannerRouter.patch('/deadlines/:id', async (req, res) => {
  const body = parse(z.object({ status: z.enum(['open', 'done', 'dismissed']) }), req.body);
  const d = await DeadlineModel.findOneAndUpdate({ _id: req.params.id, userId: uid(req) }, { $set: { status: body.status } }, { new: true }).lean();
  if (!d) throw notFound('Deadline');
  res.json({ deadline: { ...d, id: String(d._id) } });
});

plannerRouter.delete('/deadlines/:id', async (req, res) => {
  await DeadlineModel.deleteOne({ _id: req.params.id, userId: uid(req), origin: { $ne: 'generated' } });
  res.json({ deleted: true });
});

plannerRouter.get('/deductions/:taxYear', async (req, res) => {
  const { profile } = await getProfile(uid(req), taxYearParam(req.params.taxYear));
  res.json(deductionFinder(profile));
});
