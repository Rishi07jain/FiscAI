import { LotSchema, type Lot } from '@fiscai/shared-types';
import { buildPortfolio, harvest, realisedForYear } from '@fiscai/tax-engine';
import { Router } from 'express';
import { z } from 'zod';
import { notFound, parse, taxYearParam, today } from '../lib/http';
import { requireAuth, uid } from '../middleware/auth';
import { LotModel } from '../models';
import { syncDeadlines } from '../services/deadlines';
import { getProfile, saveProfile } from '../services/profile';

export const portfolioRouter = Router();
portfolioRouter.use(requireAuth);

const toLot = (l: any): Lot & { id: string } => ({ id: String(l._id), ...LotSchema.parse({ ...l, isin: l.isin ?? undefined, currentPrice: l.currentPrice ?? undefined, sellDate: l.sellDate ?? undefined, sellPrice: l.sellPrice ?? undefined }) });

async function userLots(userId: any) {
  return (await LotModel.find({ userId }).sort({ buyDate: 1 }).lean()).map(toLot);
}

portfolioRouter.get('/lots', async (req, res) => {
  res.json({ lots: await userLots(uid(req)) });
});

portfolioRouter.post('/lots', async (req, res) => {
  const lot = parse(LotSchema, req.body);
  const d = await LotModel.create({ ...lot, userId: uid(req) });
  res.status(201).json({ lot: toLot(d.toObject()) });
});

portfolioRouter.put('/lots/:id', async (req, res) => {
  const lot = parse(LotSchema, req.body);
  const d = await LotModel.findOneAndUpdate({ _id: req.params.id, userId: uid(req) }, { $set: lot }, { new: true }).lean();
  if (!d) throw notFound('Lot');
  res.json({ lot: toLot(d) });
});

/** Bulk update current prices: { prices: { SYMBOL: price } } */
portfolioRouter.post('/prices', async (req, res) => {
  const { prices } = parse(z.object({ prices: z.record(z.coerce.number().min(0)) }), req.body);
  const userId = uid(req);
  await Promise.all(Object.entries(prices).map(([sym, p]) => LotModel.updateMany({ userId, symbol: sym, sellDate: { $exists: false } }, { $set: { currentPrice: p } })));
  res.json({ updated: Object.keys(prices).length });
});

portfolioRouter.delete('/lots/:id', async (req, res) => {
  const r = await LotModel.deleteOne({ _id: req.params.id, userId: uid(req) });
  if (!r.deletedCount) throw notFound('Lot');
  res.json({ deleted: true });
});

portfolioRouter.get('/', async (req, res) => {
  const userId = uid(req);
  const taxYear = taxYearParam(req.query.taxYear ?? '2026-27');
  const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : today();
  const { profile } = await getProfile(userId, taxYear);
  const lots = await userLots(userId);
  const unsynced = { ...profile, capitalGains: profile.capitalGains.filter((t) => !t.id?.startsWith('lot:')) };
  const view = buildPortfolio(lots, asOf, taxYear, unsynced);
  const synced = profile.capitalGains.filter((t) => t.id?.startsWith('lot:')).length;
  res.json({ ...view, syncedToProfile: synced });
});

portfolioRouter.get('/harvest', async (req, res) => {
  const userId = uid(req);
  const taxYear = taxYearParam(req.query.taxYear ?? '2026-27');
  const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : today();
  const { profile } = await getProfile(userId, taxYear);
  // Realised portfolio trades are added inside harvest(); avoid double counting synced ones.
  const base = { ...profile, capitalGains: profile.capitalGains.filter((t) => !t.id?.startsWith('lot:')) };
  res.json(harvest(base, await userLots(userId), asOf));
});

/** Replace the profile's portfolio-sourced capital gains with this year's realised FIFO sales. */
portfolioRouter.post('/sync', async (req, res) => {
  const userId = uid(req);
  const taxYear = taxYearParam(req.body?.taxYear ?? '2026-27');
  const { profile } = await getProfile(userId, taxYear);
  const view = buildPortfolio(await userLots(userId), today(), taxYear);
  const realised = realisedForYear(view, taxYear).map((t, i) => ({ ...t, id: `lot:${i}:${t.sellDate}` }));
  const next = { ...profile, capitalGains: [...profile.capitalGains.filter((t) => !t.id?.startsWith('lot:')), ...realised] };
  const r = await saveProfile(userId, taxYear, next, 'portfolio');
  await syncDeadlines(userId, taxYear);
  res.json({ synced: realised.length, profileVersion: r.version });
});
