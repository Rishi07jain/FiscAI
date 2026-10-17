import { HouseholdMemberSchema, VdaTxnSchema } from '@fiscai/shared-types';
import { buildItrPack, householdView, reconcileAis, summariseFno, summariseVda, type AisCategory } from '@fiscai/tax-engine';
import { Router } from 'express';
import { z } from 'zod';
import { notFound, parse, taxYearParam } from '../lib/http';
import { requireAuth, uid } from '../middleware/auth';
import { AisEntryModel, FnoPriorLossModel, FnoTradeModel, HouseholdMemberModel } from '../models';
import { syncDeadlines } from '../services/deadlines';
import { itrPdf } from '../services/itrPdf';
import { getProfile, saveProfile } from '../services/profile';

export const p2Router = Router();
p2Router.use(['/fno', '/itr', '/ais', '/vda', '/household'], requireAuth);

// ---- F12 F&O and trader module ----------------------------------------------
const TradeBody = z.object({
  taxYear: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), symbol: z.string().min(1), segment: z.enum(['FUT', 'OPT', 'INTRADAY_EQ']),
  pnl: z.coerce.number(), sellValue: z.coerce.number().min(0).default(0), exercised: z.boolean().optional(), exerciseValue: z.coerce.number().optional(),
  charges: z.coerce.number().min(0).optional(), stt: z.coerce.number().min(0).optional(),
});

async function fnoSummary(userId: any, taxYear: string) {
  const trades = await FnoTradeModel.find({ userId, taxYear }).sort({ date: 1 }).lean();
  const prior = await FnoPriorLossModel.find({ userId }).lean();
  return { trades: trades.map((t) => ({ ...t, id: String(t._id) })), summary: summariseFno(trades as any, taxYear, prior.map((p) => ({ year: p.year!, loss: p.loss! }))), priorLosses: prior.map((p) => ({ id: String(p._id), year: p.year, loss: p.loss })) };
}

p2Router.get('/fno/:taxYear', async (req, res) => {
  res.json(await fnoSummary(uid(req), taxYearParam(req.params.taxYear)));
});
p2Router.post('/fno/trades', async (req, res) => {
  const b = parse(TradeBody, req.body);
  const d = await FnoTradeModel.create({ ...b, taxYear: taxYearParam(b.taxYear), userId: uid(req), source: 'manual' });
  res.status(201).json({ trade: { ...d.toObject(), id: String(d._id) } });
});
p2Router.delete('/fno/trades/:id', async (req, res) => {
  await FnoTradeModel.deleteOne({ _id: req.params.id, userId: uid(req) });
  res.json({ deleted: true });
});
p2Router.post('/fno/prior-losses', async (req, res) => {
  const b = parse(z.object({ year: z.string().regex(/^\d{4}-\d{2}$/), loss: z.coerce.number().positive() }), req.body);
  const d = await FnoPriorLossModel.create({ ...b, userId: uid(req) });
  res.status(201).json({ id: String(d._id) });
});
p2Router.delete('/fno/prior-losses/:id', async (req, res) => {
  await FnoPriorLossModel.deleteOne({ _id: req.params.id, userId: uid(req) });
  res.json({ deleted: true });
});
/** Push the F&O / intraday totals into the profile's business income. */
p2Router.post('/fno/:taxYear/apply', async (req, res) => {
  const userId = uid(req);
  const taxYear = taxYearParam(req.params.taxYear);
  const { summary, priorLosses } = await fnoSummary(userId, taxYear);
  const { profile } = await getProfile(userId, taxYear);
  profile.business = { ...profile.business, fnoTurnover: summary.fno.turnover, fnoProfit: summary.fno.netProfit, speculativeTurnover: summary.intraday.turnover, speculativeProfit: summary.intraday.netProfit };
  profile.broughtForwardLosses.business = priorLosses.reduce((s, p) => s + (p.loss ?? 0), 0);
  if (!profile.personal.incomeSources.includes('fno')) profile.personal.incomeSources.push('fno');
  const r = await saveProfile(userId, taxYear, profile, 'fno');
  await syncDeadlines(userId, taxYear);
  res.json({ profileVersion: r.version });
});

// ---- F13 ITR readiness pack ------------------------------------------------------
p2Router.get('/itr/:taxYear', async (req, res) => {
  const { profile } = await getProfile(uid(req), taxYearParam(req.params.taxYear));
  res.json(buildItrPack(profile));
});
p2Router.get('/itr/:taxYear/pdf', async (req, res) => {
  const taxYear = taxYearParam(req.params.taxYear);
  const { profile } = await getProfile(uid(req), taxYear);
  const pdf = await itrPdf(buildItrPack(profile));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="fiscai-itr-pack-${taxYear}.pdf"`);
  res.send(pdf);
});

// ---- F14 AIS reconciliation ---------------------------------------------------------
p2Router.get('/ais/:taxYear', async (req, res) => {
  const userId = uid(req);
  const taxYear = taxYearParam(req.params.taxYear);
  const entries = await AisEntryModel.find({ userId, taxYear }).lean();
  const { profile } = await getProfile(userId, taxYear);
  const rec = reconcileAis(profile, entries.map((e) => ({ category: e.category as AisCategory, source: e.source ?? '', amount: e.amount ?? 0, tds: e.tds ?? 0 })));
  res.json({ entries: entries.map((e) => ({ ...e, id: String(e._id) })), ...rec });
});
p2Router.post('/ais/entries', async (req, res) => {
  const b = parse(z.object({ taxYear: z.string(), category: z.enum(['salary', 'interest_savings', 'interest_fd', 'dividend', 'sale_securities', 'sale_mf', 'rent_received', 'vda_transfer', 'tds', 'tcs', 'other']), source: z.string().default(''), amount: z.coerce.number(), tds: z.coerce.number().default(0) }), req.body);
  const d = await AisEntryModel.create({ ...b, taxYear: taxYearParam(b.taxYear), userId: uid(req) });
  res.status(201).json({ entry: { ...d.toObject(), id: String(d._id) } });
});
p2Router.delete('/ais/entries/:id', async (req, res) => {
  await AisEntryModel.deleteOne({ _id: req.params.id, userId: uid(req) });
  res.json({ deleted: true });
});

// ---- F15 Crypto (VDA) ---------------------------------------------------------------
p2Router.get('/vda/:taxYear', async (req, res) => {
  const taxYear = taxYearParam(req.params.taxYear);
  const { profile } = await getProfile(uid(req), taxYear);
  res.json(summariseVda(profile.vda, taxYear));
});
p2Router.put('/vda/:taxYear', async (req, res) => {
  const taxYear = taxYearParam(req.params.taxYear);
  const txns = parse(z.array(VdaTxnSchema), req.body?.txns);
  const { profile } = await getProfile(uid(req), taxYear);
  profile.vda = txns;
  if (txns.length && !profile.personal.incomeSources.includes('crypto')) profile.personal.incomeSources.push('crypto');
  const r = await saveProfile(uid(req), taxYear, profile, 'vda');
  res.json({ profileVersion: r.version, summary: summariseVda(txns, taxYear) });
});

// ---- F16 Household view -----------------------------------------------------------------
const toMember = (m: any) => ({ id: String(m._id), ...HouseholdMemberSchema.parse({ ...m, profile: m.profile ?? {} }) });

p2Router.get('/household/members', async (req, res) => {
  const list = await HouseholdMemberModel.find({ userId: uid(req) }).lean();
  res.json({ members: list.map(toMember) });
});
p2Router.post('/household/members', async (req, res) => {
  const m = parse(HouseholdMemberSchema, req.body);
  const d = await HouseholdMemberModel.create({ ...m, userId: uid(req) });
  res.status(201).json({ member: toMember(d.toObject()) });
});
p2Router.put('/household/members/:id', async (req, res) => {
  const m = parse(HouseholdMemberSchema, req.body);
  const d = await HouseholdMemberModel.findOneAndUpdate({ _id: req.params.id, userId: uid(req) }, { $set: m }, { new: true }).lean();
  if (!d) throw notFound('Member');
  res.json({ member: toMember(d) });
});
p2Router.delete('/household/members/:id', async (req, res) => {
  await HouseholdMemberModel.deleteOne({ _id: req.params.id, userId: uid(req) });
  res.json({ deleted: true });
});
p2Router.get('/household/:taxYear', async (req, res) => {
  const userId = uid(req);
  const { profile } = await getProfile(userId, taxYearParam(req.params.taxYear));
  const members = (await HouseholdMemberModel.find({ userId }).lean()).map(toMember);
  res.json(householdView(profile, members));
});
