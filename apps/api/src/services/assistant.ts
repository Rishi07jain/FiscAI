import { SCENARIO_TYPES, TaxProfileSchema, type ScenarioType, type TaxProfile } from '@fiscai/shared-types';
import { compareRegimes, computeTax, runScenario } from '@fiscai/tax-engine';
import { llm, type ToolDecl } from './llm';
import { getRuleCard, searchRules, type CardHit } from './rag';

export type AssistantEvent =
  | { type: 'tool'; name: string; args: unknown; summary: string }
  | { type: 'delta'; text: string }
  | { type: 'citations'; cards: CardHit[] }
  | { type: 'scenario'; scenarioType: ScenarioType; inputs: unknown; label: string };

export const SYSTEM_PROMPT = `You are FiscAI, a tax assistant for Indian salaried and investing individuals (Tax Year 2026-27 under the Income-tax Act, 2025; FY 2025-26 under the 1961 Act).

Hard rules:
1. NEVER do arithmetic yourself. Every rupee amount, rate applied, or difference you state must come from a tool result (computeTax, runScenario). If you need a number, call a tool. Quote tool numbers exactly.
2. Every answer must cite at least one rule card in square brackets using its ruleId, e.g. [REBATE-87A]. Use searchRules or getRule to find the right card. When you name a section, give the familiar 1961-Act name and the 2025-Act number from the card (write "TBC" if the card says TBC).
3. For personal questions ("my tax", "should I"), call getProfile first and use the user's data. For general questions, answer for anyone.
4. For "what if" questions, call runScenario (or computeTax with changes) so the user can open the same comparison as a scenario.
5. If a question is outside scope (NRI/DTAA, company tax, filing on the portal, which stock to buy) or you are uncertain, say so plainly and suggest consulting a chartered accountant.
6. Show tax effects only. Never recommend buying or selling specific securities.
7. Be concise: lead with the answer, then the numbers, then the rule. Use short paragraphs or bullets. Amounts as "Rs 1,23,456".`;

const TOOLS: ToolDecl[] = [
  { name: 'getProfile', description: "Get a summary of the user's tax profile for the active Tax Year (no personal identifiers).", parameters: { type: 'object', properties: {} } },
  {
    name: 'computeTax',
    description: 'Compute tax with the deterministic rules engine. Optionally apply hypothetical changes (deep-merged into the profile, amounts in rupees). Returns totals for the requested regime(s) and the rule IDs used.',
    parameters: {
      type: 'object',
      properties: {
        regime: { type: 'string', enum: ['new', 'old', 'both'] },
        changes: { type: 'object', description: 'Partial profile, e.g. {"deductions":{"healthParents":50000},"personal":{"parentsSenior":true}}' },
      },
    },
  },
  {
    name: 'runScenario',
    description: `Run a what-if scenario on the user's profile. Types: ${SCENARIO_TYPES.join(', ')}. Inputs per type: sell_equity {symbol, lots:[{qty,buyDate,buyPrice}], qty, price, date}; sell_property {buyDate,cost,saleDate,salePrice,isResidentialHouse,reinvest:{sec54,sec54F,sec54EC}}; home_loan {price,loan,ratePct,tenureYears,occupancy}; salary_change {ctc,basicPct,hraPctOfBasic,employerNpsPctOfBasic,city,rentPaid}; invest_deduction {kind: sec80C|sec80CCD1B|healthSelf|healthParents|sec80E|employerNps, amount}; redeem_sgb {units,buyPrice,redemptionPrice,buyDate,redeemDate,route}; buyback {shares,buybackPrice,costPerShare,buyDate,date}; switch_regime {regime}. Dates YYYY-MM-DD.`,
    parameters: { type: 'object', properties: { type: { type: 'string', enum: [...SCENARIO_TYPES] }, inputs: { type: 'object' } }, required: ['type', 'inputs'] },
  },
  { name: 'searchRules', description: "Search FiscAI's curated rule cards (with 1961 and 2025 Act section references).", parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'getRule', description: 'Get one rule card by ruleId.', parameters: { type: 'object', properties: { ruleId: { type: 'string' } }, required: ['ruleId'] } },
];

function deepMerge(a: any, b: any): any {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
  const out = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v);
  return out;
}

export function profileSummary(p: TaxProfile) {
  const s = p.salary;
  return {
    taxYear: p.taxYear, regime: p.regime, ageBand: p.personal.ageBand, residency: p.personal.residency, city: p.personal.city,
    employmentType: p.personal.employmentType, incomeSources: p.personal.incomeSources, parentsSenior: p.personal.parentsSenior,
    salary: { basic: s.basic, da: s.da, hra: s.hra, specialAllowance: s.specialAllowance, otherAllowances: s.otherAllowances, bonus: s.bonus, employerNps: s.employerNps, rentPaid: s.rentPaid },
    houseProperty: p.houseProperty, otherIncome: p.otherIncome, business: p.business, deductions: p.deductions,
    capitalGains: p.capitalGains.map((t) => ({ assetType: t.assetType, buyDate: t.buyDate, sellDate: t.sellDate, cost: t.cost, saleValue: t.saleValue })),
    vdaCount: p.vda.length, taxesPaid: { tds: p.taxesPaid.tds, advanceTax: p.taxesPaid.advanceTax },
  };
}

const brief = (r: ReturnType<typeof computeTax>) => ({
  regime: r.regime, totalIncome: r.totalIncome, slabTax: r.slabTax, specialTax: r.specialTax.total, rebate: r.rebate, marginalRelief: r.marginalRelief,
  surcharge: r.surcharge, cess: r.cess, totalTax: r.totalTax, balanceAfterTdsAndAdvanceTax: r.balance, effectiveRatePct: Math.round(r.effectiveRate * 1000) / 10,
  deductionsAllowed: r.deductions.total, ruleIds: [...new Set(r.trace.map((t) => t.ruleId).filter(Boolean))],
});

export function makeToolRunner(profile: TaxProfile, emit: (e: AssistantEvent) => void, used: Set<string>) {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    switch (name) {
      case 'getProfile':
        return profileSummary(profile);
      case 'computeTax': {
        const p = args.changes ? TaxProfileSchema.parse(deepMerge(profile, args.changes)) : profile;
        const regime = (args.regime as string) ?? 'both';
        if (regime === 'both') {
          const c = compareRegimes(p);
          c.new.trace.concat(c.old.trace).forEach((t) => t.ruleId && used.add(t.ruleId));
          return { new: brief(c.new), old: brief(c.old), recommended: c.recommended, difference: c.savings, breakEvenExtraOldRegimeDeductions: c.breakEvenDeductions };
        }
        const r = computeTax(p, regime as 'new' | 'old');
        r.trace.forEach((t) => t.ruleId && used.add(t.ruleId));
        return brief(r);
      }
      case 'runScenario': {
        const type = args.type as ScenarioType;
        const r = runScenario(profile, type, args.inputs);
        r.ruleIds.forEach((id) => used.add(id));
        emit({ type: 'scenario', scenarioType: type, inputs: args.inputs, label: type.replace(/_/g, ' ') });
        return { before: r.before, after: r.after, changeInChosenRegime: r.delta, bestRegimeAfter: r.bestRegimeAfter, insights: r.insights.map((i) => i.text), deadlines: r.deadlines, ruleIds: r.ruleIds };
      }
      case 'searchRules': {
        const hits = await searchRules(String(args.query ?? ''), 4);
        return hits.map((h) => ({ ruleId: h.ruleId, title: h.title, refs: h.refs, status: h.status, body: h.body }));
      }
      case 'getRule':
        return (await getRuleCard(String(args.ruleId))) ?? { error: 'Unknown ruleId' };
      default:
        return { error: `Unknown tool ${name}` };
    }
  };
}

const summarise = (name: string, result: any): string => {
  if (name === 'computeTax' && result?.new) return `New regime Rs ${result.new.totalTax.toLocaleString('en-IN')} · Old regime Rs ${result.old.totalTax.toLocaleString('en-IN')}`;
  if (name === 'computeTax' && result?.totalTax !== undefined) return `${result.regime} regime: Rs ${result.totalTax.toLocaleString('en-IN')}`;
  if (name === 'runScenario' && result?.after) return `Before Rs ${result.before.chosen.toLocaleString('en-IN')} → after Rs ${result.after.chosen.toLocaleString('en-IN')}`;
  if (name === 'searchRules' && Array.isArray(result)) return result.map((r: any) => r.ruleId).join(', ');
  if (name === 'getProfile') return 'Read your profile';
  return 'done';
};

/** Run one assistant turn. Returns the final text and citations. */
export async function runAssistant(profile: TaxProfile, history: { role: 'user' | 'assistant'; text: string }[], message: string, emit: (e: AssistantEvent) => void) {
  const used = new Set<string>();
  const callTool = makeToolRunner(profile, emit, used);
  let text = '';

  if (llm().available) {
    const res = await llm().chat({
      system: SYSTEM_PROMPT,
      history: history.slice(-12),
      message,
      tools: TOOLS,
      callTool,
      onText: (d) => { text += d; emit({ type: 'delta', text: d }); },
      onToolCall: (name, args, result) => emit({ type: 'tool', name, args, summary: summarise(name, result) }),
    });
    text = res.text || text;
  } else {
    text = await fallbackAnswer(profile, message, callTool, emit);
  }

  // Citations: cards referenced as [RULE-ID]; if none, attach the closest cards (every answer carries a citation).
  const cited = [...new Set([...text.matchAll(/\[([A-Z0-9]+(?:-[A-Z0-9]+)+)\]/g)].map((m) => m[1]))];
  let cards = (await Promise.all(cited.map((id) => getRuleCard(id)))).filter((c): c is CardHit => Boolean(c));
  if (!cards.length) cards = (await Promise.all([...used].slice(0, 3).map((id) => getRuleCard(id)))).filter((c): c is CardHit => Boolean(c));
  if (!cards.length) cards = await searchRules(message, 2);
  emit({ type: 'citations', cards });
  return { text, citations: cards.map((c) => c.ruleId) };
}

/** Deterministic answer when no LLM key is configured: engine numbers + matching rule cards. */
async function fallbackAnswer(profile: TaxProfile, message: string, callTool: ReturnType<typeof makeToolRunner>, emit: (e: AssistantEvent) => void) {
  const out: string[] = ['_The language model is not configured (set GEMINI_API_KEY), so here is what the rules engine and rule cards say._\n'];
  if (/regime|old|new|which|compare|tax|owe|pay/i.test(message)) {
    const r: any = await callTool('computeTax', { regime: 'both' });
    emit({ type: 'tool', name: 'computeTax', args: { regime: 'both' }, summary: summarise('computeTax', r) });
    out.push(`On your current profile: new regime **Rs ${r.new.totalTax.toLocaleString('en-IN')}**, old regime **Rs ${r.old.totalTax.toLocaleString('en-IN')}**. The ${r.recommended} regime is lower by Rs ${r.difference.toLocaleString('en-IN')} [REGIME-NEW].`);
  }
  const hits = await searchRules(message, 3);
  emit({ type: 'tool', name: 'searchRules', args: { query: message }, summary: hits.map((h) => h.ruleId).join(', ') });
  for (const h of hits) out.push(`**${h.title}** (old ${h.refs.ita1961}, new ${h.refs.ita2025}) [${h.ruleId}]: ${h.body}`);
  if (!hits.length) out.push('I could not find a rule card for this. For questions outside FiscAI’s scope, please consult a chartered accountant [DISCLAIMER].');
  const text = out.join('\n\n');
  for (const chunk of text.match(/.{1,60}/gs) ?? []) emit({ type: 'delta', text: chunk });
  return text;
}
