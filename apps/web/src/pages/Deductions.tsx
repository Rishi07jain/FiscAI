import { motion } from 'motion/react';
import { Info } from 'lucide-react';
import { RuleChip } from '../components/RuleChip';
import { Card, CardHeader, Chip, cn, ErrorNote, PageHeader, Skeleton } from '../components/ui';
import { inr } from '../lib/format';
import { useDeductions } from '../lib/queries';

export default function Deductions() {
  const { data, isLoading, error } = useDeductions();
  if (isLoading || !data) return <Skeleton className="h-96" />;
  if (error) return <ErrorNote error={error} />;
  return (
    <div>
      <PageHeader label="F10 · Deduction & scheme finder" title="Unused headroom, in rupees" description="Each limit, how much you've used, and what filling it would save — computed by the engine, shown only where your regime allows it." />
      <div className={cn('mb-4 flex items-start gap-2 rounded-md border px-4 py-3 text-sm', data.regime === 'new' ? 'border-c2/30 bg-c2/10 text-c2' : 'border-line bg-card text-muted-fg')}><Info className="mt-0.5 size-4 shrink-0" />{data.note}</div>
      <div className="grid gap-3 md:grid-cols-2">
        {data.headroom.map((h, i) => {
          const pct = h.limit ? Math.min(1, h.used / h.limit) : 0;
          const saving = h.taxSavedIfFilled[data.regime];
          const otherSaving = h.taxSavedIfFilled[data.regime === 'new' ? 'old' : 'new'];
          const allowed = h.regimes.includes(data.regime);
          return (
            <motion.div key={h.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Card className={cn('h-full p-5', !allowed && 'opacity-75')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-medium">{h.label}</div>
                  <RuleChip ruleId={h.ruleId} />
                </div>
                <div className="mt-1 flex gap-1.5">{h.regimes.map((r) => <Chip key={r} tone={r === data.regime ? 'lime' : 'muted'}>{r}</Chip>)}</div>
                {h.limit !== null ? (
                  <>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><motion.div className="h-full rounded-full bg-lime" initial={{ width: 0 }} animate={{ width: `${pct * 100}%` }} transition={{ duration: 0.8 }} /></div>
                    <div className="mt-2 flex justify-between text-xs text-muted-fg"><span>{inr(h.used)} used</span><span>{h.remaining ? <span className="text-fg">{inr(h.remaining)} of {inr(h.limit)} left</span> : 'Maxed out'}</span></div>
                  </>
                ) : <div className="mt-4 text-xs text-muted-fg">No upper limit · {inr(h.used)} claimed</div>}
                {(saving > 0 || otherSaving > 0) && (
                  <div className="mt-3 border-t border-line pt-3 text-xs">
                    {allowed && saving > 0 ? <span className="text-lime">Filling it saves {inr(saving)} in your regime</span> : <span className="text-muted-fg">No effect in your regime · would save {inr(otherSaving)} in the {data.regime === 'new' ? 'old' : 'new'} regime</span>}
                  </div>
                )}
              </Card>
            </motion.div>
          );
        })}
      </div>
      <Card className="mt-6">
        <CardHeader label="Schemes" title={data.schemes.length ? 'Matching schemes, valued for you' : 'No scheme reduces your tax in this regime'} />
        <div className="divide-y divide-line">
          {data.schemes.map((s) => (
            <div key={s.key} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{s.name}<Chip tone="muted">{s.section}</Chip>{!s.eligible && <Chip tone="orange">Check eligibility</Chip>}</div>
                <div className="mt-0.5 text-xs text-muted-fg">{s.eligibilityNote} · Lock-in: {s.lockIn}</div>
              </div>
              <div className="text-right text-sm"><div className="text-lime tabular">saves {inr(s.taxBenefit[data.regime])}</div><div className="text-xs text-muted-fg">on {inr(s.suggestedAmount)}</div></div>
            </div>
          ))}
          {!data.schemes.length && <div className="px-5 py-5 text-sm text-muted-fg">On the new regime only employer NPS reduces tax. See the Regime page for whether switching would pay off.</div>}
        </div>
        <div className="border-t border-line px-5 py-3 text-xs text-muted-fg">FiscAI shows tax effects only. It does not recommend specific investment products.</div>
      </Card>
    </div>
  );
}
