import type { SummaryLine } from '@fiscai/tax-engine';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { inr } from '../lib/format';
import { RuleChip } from './RuleChip';
import { cn } from './ui';

const STRONG = new Set(['gti', 'ti', 'total', 'balance']);

/** One line of the tax computation with a working "why" expander. */
export function WhyLine({ line, depth = 0 }: { line: SummaryLine; depth?: number }) {
  const [open, setOpen] = useState(false);
  const strong = STRONG.has(line.key);
  return (
    <div className={cn(depth === 0 && 'border-b border-line last:border-b-0')}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={cn('group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-card-2', depth > 0 && 'py-2 pl-12')} aria-expanded={open}>
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-fg transition-transform', open && 'rotate-90 text-lime')} />
        <span className={cn('flex-1 text-sm', strong ? 'font-medium text-fg' : 'text-fg/85', depth > 0 && 'text-[0.82rem] text-muted-fg')}>{line.label}</span>
        <span className={cn('tabular text-sm', strong ? 'font-medium' : '', line.key === 'balance' && (line.amount > 0 ? 'text-c2' : 'text-lime'), line.amount < 0 && line.key !== 'balance' && 'text-muted-fg')}>
          {line.key === 'balance' ? inr(Math.abs(line.amount)) : inr(line.amount)}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className={cn('mx-5 mb-3 rounded-md border border-line bg-card-2 px-4 py-3 text-[0.8rem] leading-relaxed text-muted-fg', depth > 0 && 'ml-12')}>
              <p>{line.explain}</p>
              {line.ruleId && <div className="mt-2"><RuleChip ruleId={line.ruleId} /></div>}
            </div>
            {line.children?.map((c) => <WhyLine key={c.key} line={c} depth={depth + 1} />)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
