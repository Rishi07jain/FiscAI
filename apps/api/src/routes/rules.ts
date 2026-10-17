import { listPacks } from '@fiscai/tax-engine';
import { Router } from 'express';
import { notFound } from '../lib/http';
import { RuleCardModel } from '../models';
import { getRuleCard, searchRules } from '../services/rag';

export const rulesRouter = Router();

rulesRouter.get('/', async (req, res) => {
  if (typeof req.query.q === 'string' && req.query.q.trim()) return res.json({ cards: await searchRules(req.query.q, 8) });
  const cards = await RuleCardModel.find({}, { embedding: 0 }).sort({ ruleId: 1 }).lean();
  res.json({ cards });
});

rulesRouter.get('/packs', (_req, res) => {
  res.json({ packs: listPacks().map((p) => ({ id: p.id, act: p.act, taxYear: p.taxYear, regime: p.regime, effectiveFrom: p.effectiveFrom, sources: p.sources })) });
});

rulesRouter.get('/packs/:id', (req, res) => {
  const p = listPacks().find((x) => x.id === req.params.id);
  if (!p) throw notFound('Rule pack');
  res.json({ pack: p });
});

rulesRouter.get('/:ruleId', async (req, res) => {
  const c = await getRuleCard(req.params.ruleId);
  if (!c) throw notFound('Rule');
  res.json({ card: c });
});
