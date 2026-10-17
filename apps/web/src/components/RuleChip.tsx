import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, ExternalLink } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRule } from '../lib/queries';
import { cn, Spinner } from './ui';

const W = 360;

/** A clickable rule reference showing the familiar (1961 Act) and new (2025 Act) section. */
export function RuleChip({ ruleId, className }: { ruleId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; above: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useRule(open ? ruleId : undefined);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = Math.min(W, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
    const above = r.bottom + 260 > window.innerHeight && r.top > 280;
    setPos(above ? { bottom: window.innerHeight - r.top + 8, left, above } : { top: r.bottom + 8, left, above });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || pop.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className={cn('inline-flex items-center gap-1 rounded-[4px] border border-lime/30 bg-lime-soft px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-lime transition hover:border-lime/60', className)}>
        <BookOpen className="size-2.5" />{ruleId}
      </button>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div ref={pop} initial={{ opacity: 0, y: pos.above ? -4 : 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onClick={(e) => e.stopPropagation()}
              style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: Math.min(W, window.innerWidth - 24) }}
              className="z-[70] rounded-lg border border-line-strong bg-card p-4 text-left shadow-2xl">
              {isLoading || !data ? <Spinner /> : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium text-fg">{data.title}</div>
                    {data.status !== 'final' && <span className="shrink-0 font-mono text-[0.55rem] uppercase text-warn">{data.status.includes('draft') ? 'draft rules' : 'new § TBC'}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[0.6rem] text-muted-fg">1961 Act · {data.refs.ita1961}</span>
                    <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[0.6rem] text-muted-fg">2025 Act · {data.refs.ita2025}</span>
                  </div>
                  <p className="mt-3 text-[0.8rem] leading-relaxed text-muted-fg">{data.body}</p>
                  {data.sourceUrl && <a href={data.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-lime hover:underline">Source <ExternalLink className="size-3" /></a>}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
