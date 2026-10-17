import new2526 from '../packs/IN-TY2025-26-NEW.json';
import old2526 from '../packs/IN-TY2025-26-OLD.json';
import new2627 from '../packs/IN-TY2026-27-NEW.json';
import old2627 from '../packs/IN-TY2026-27-OLD.json';
import cards from '../rule-cards.json';

export const rulePacks = [new2526, old2526, new2627, old2627] as const;
export const ruleCards = cards as RuleCardData[];

export interface RuleCardData {
  ruleId: string;
  title: string;
  body: string;
  refs: { ita1961: string; ita2025: string };
  status: string;
  sourceUrl: string;
  tags: string[];
}

export const SUPPORTED_TAX_YEARS = ['2025-26', '2026-27'] as const;
