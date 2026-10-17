import { ruleCards, type RuleCardData } from '@fiscai/rule-packs';

export function getRule(ruleId: string): RuleCardData | undefined {
  return ruleCards.find((c) => c.ruleId === ruleId);
}

/** Lightweight keyword retrieval used when vector search is unavailable. */
export function searchRulesKeyword(query: string, k = 5): RuleCardData[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  const scored = ruleCards.map((c) => {
    const hay = `${c.ruleId} ${c.title} ${c.body} ${c.refs.ita1961} ${c.refs.ita2025} ${c.tags.join(' ')}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      const hits = hay.split(t).length - 1;
      score += hits * (c.title.toLowerCase().includes(t) ? 3 : 1) + (c.refs.ita1961.toLowerCase().includes(t) ? 5 : 0);
    }
    return { c, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k).map((s) => s.c);
}

export { ruleCards };
