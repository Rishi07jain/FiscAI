import { ruleCards } from '@fiscai/rule-packs';
import { listPacks, searchRulesKeyword } from '@fiscai/tax-engine';
import { env, flags } from '../env';
import { RuleCardModel, RulePackModel } from '../models';
import { llm } from './llm';

export interface CardHit { ruleId: string; title: string; body: string; refs: { ita1961: string; ita2025: string }; status: string; sourceUrl: string; score?: number }

/** Seed rule packs and rule cards from packages/*; embed cards when an LLM key is configured. */
export async function seedRules() {
  for (const p of listPacks()) {
    await RulePackModel.updateOne({ packId: p.id }, { $set: { act: p.act, taxYear: p.taxYear, regime: p.regime, rules: p, effectiveFrom: p.effectiveFrom, sourceUrls: p.sources.map((s) => s.url) } }, { upsert: true });
  }
  for (const c of ruleCards) {
    await RuleCardModel.updateOne({ ruleId: c.ruleId }, { $set: { title: c.title, body: c.body, refs: c.refs, status: c.status, sourceUrl: c.sourceUrl, tags: c.tags } }, { upsert: true });
  }
  if (llm().available) {
    const missing = await RuleCardModel.find({ $or: [{ embedding: { $exists: false } }, { embeddingModel: { $ne: env.GEMINI_EMBED_MODEL } }] }).lean();
    if (missing.length) {
      try {
        const vecs = await llm().embed(missing.map((c) => `${c.title}\n${c.refs?.ita1961} ${c.refs?.ita2025}\n${c.body}`));
        await Promise.all(missing.map((c, i) => RuleCardModel.updateOne({ _id: c._id }, { $set: { embedding: vecs[i], embeddingModel: env.GEMINI_EMBED_MODEL } })));
        console.log(`[rag] embedded ${missing.length} rule cards`);
      } catch (e) {
        console.warn('[rag] embedding failed; keyword retrieval will be used', (e as Error).message);
      }
    }
  }
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

const toHit = (c: any, score?: number): CardHit => ({ ruleId: c.ruleId, title: c.title, body: c.body, refs: c.refs, status: c.status, sourceUrl: c.sourceUrl, score });

export async function searchRules(query: string, k = 4): Promise<CardHit[]> {
  if (llm().available) {
    try {
      const [q] = await llm().embed([query]);
      if (flags.atlasVector) {
        const hits = await RuleCardModel.aggregate([
          { $vectorSearch: { index: 'rulecards_vector', path: 'embedding', queryVector: q, numCandidates: 50, limit: k } },
          { $project: { embedding: 0, score: { $meta: 'vectorSearchScore' } } },
        ]);
        if (hits.length) return hits.map((h) => toHit(h, h.score));
      }
      const cards = await RuleCardModel.find({ embedding: { $exists: true } }).lean();
      if (cards.length) {
        return cards.map((c) => ({ c, s: cosine(q, c.embedding as number[]) })).sort((a, b) => b.s - a.s).slice(0, k).map(({ c, s }) => toHit(c, s));
      }
    } catch (e) {
      console.warn('[rag] vector search failed, falling back to keywords', (e as Error).message);
    }
  }
  return searchRulesKeyword(query, k).map((c) => toHit(c));
}

export async function getRuleCard(ruleId: string): Promise<CardHit | null> {
  const c = await RuleCardModel.findOne({ ruleId }, { embedding: 0 }).lean();
  if (c) return toHit(c);
  const s = ruleCards.find((x) => x.ruleId === ruleId);
  return s ? toHit(s) : null;
}
