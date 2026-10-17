import { motion } from 'motion/react';
import { ArrowRightLeft, Check, Info, Sparkles } from 'lucide-react';
import { RuleChip } from '../components/RuleChip';
import { AnimatedNumber, Button, Card, CardHeader, Chip, cn, ErrorNote, PageHeader, Skeleton, useToast } from '../components/ui';
import { WhyLine } from '../components/WhyLine';
import { inr } from '../lib/format';
import { useCompare, useProfile, useSaveProfile } from '../lib/queries';

export default function Regime() {
  const { data: c, isLoading, error } = useCompare();
  const profile = useProfile();
  const save = useSaveProfile();
  const toast = useToast();
  if (isLoading || !c) return <Skeleton className="h-96" />;
  if (error) return <ErrorNote error={error} />;
  const current = profile.data?.profile.regime;
  const be = c.breakEvenDeductions;
  const needed = be === null ? null : c.currentOldDeductions + be;
  const progress = needed ? Math.min(1, c.currentOldDeductions / needed) : 1;

  const choose = async (regime: 'new' | 'old') => {
    if (!profile.data) return;
    await save.mutateAsync({ ...profile.data.profile, regime });
    toast(`You're now on the ${regime} regime`);
  };

  return (
    <div>
      <PageHeader label="F4 · Regime optimiser" title={<>Old vs new, <span className="text-lime">side by side</span></>} description="Computed from the same profile under both rule packs. FiscAI computes both instead of relying on rules of thumb." />

      <div className="grid gap-4 md:grid-cols-2">
        {(['new', 'old'] as const).map((k, i) => {
          const r = c[k];
          const best = c.recommended === k;
          return (
            <motion.div key={k} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <Card className={cn('relative h-full overflow-hidden', best && 'border-lime/50 glow-lime')}>
                <div className="p-6">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><span className="label-mono mr-1 text-muted-fg">{k} regime</span>{best && <Chip tone="lime"><Sparkles className="size-3" />Recommended</Chip>}{current === k && <Chip>Yours</Chip>}<RuleChip ruleId={k === 'new' ? 'REGIME-NEW' : 'REGIME-OLD'} className="ml-auto" /></div>
                    <div className="mt-3 text-4xl font-light tracking-tight"><AnimatedNumber value={r.totalTax} format={(n) => inr(n)} /></div>
                    <div className="mt-1 text-sm text-muted-fg">Taxable {inr(r.totalIncome)} · deductions {inr(r.deductions.total + r.income.salary.hraExempt)} · effective {(r.effectiveRate * 100).toFixed(1)}%</div>
                  </div>
                </div>
                <div className="border-t border-line">{r.lines.filter((l) => ['salary', 'ded', 'ti', 'slab', 'rebate', 'special', 'surcharge', 'cess', 'total'].includes(l.key)).map((l) => <WhyLine key={l.key} line={l} />)}</div>
                <div className="border-t border-line p-4">
                  {current === k ? <div className="flex items-center gap-2 text-sm text-muted-fg"><Check className="size-4 text-lime" />You file under this regime</div>
                    : <Button variant={best ? 'primary' : 'secondary'} className="w-full" loading={save.isPending} icon={<ArrowRightLeft className="size-3.5" />} onClick={() => choose(k)}>Use {k} regime</Button>}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader label="Break-even" title={be === 0 ? 'The old regime already wins' : be === null ? 'The old regime cannot win on deductions alone' : `Old regime needs ${inr(be)} more in deductions`} />
          <div className="p-5">
            <div className="flex justify-between text-xs text-muted-fg"><span>Your old-regime deductions & exemptions</span><span>Needed to win</span></div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted">
              <motion.div className="h-full rounded-full bg-gradient-to-r from-c1 to-c2" initial={{ width: 0 }} animate={{ width: `${progress * 100}%` }} transition={{ duration: 1 }} />
            </div>
            <div className="mt-2 flex justify-between text-sm tabular"><span>{inr(c.currentOldDeductions)}</span><span>{needed === null ? '—' : inr(needed)}</span></div>
            <p className="mt-4 text-xs leading-relaxed text-muted-fg">Rule of thumb: salaried taxpayers need roughly Rs 4–8.5 lakh of combined deductions for the old regime to win. FiscAI's figure is computed for your exact income by searching for the point where old-regime tax drops below new-regime tax.</p>
          </div>
        </Card>
        <Card>
          <CardHeader label="What would flip it" title="Levers, ranked by tax saved" />
          <div className="divide-y divide-line">
            {c.levers.length ? c.levers.map((l) => (
              <div key={l.key} className="flex items-start gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{l.title}</span><Chip tone={l.regime === 'old' ? 'muted' : 'lime'}>{l.regime === 'both' ? 'works in new' : 'old only'}</Chip><RuleChip ruleId={l.ruleId} /></div>
                  <p className="mt-1 text-xs text-muted-fg">{l.detail}</p>
                </div>
                <div className="text-right"><div className="text-sm text-lime tabular">{l.taxSaved ? `−${inr(l.taxSaved)}` : '—'}</div><div className="text-[0.65rem] text-muted-fg">{l.regime === 'old' ? 'in old regime' : 'tax saved'}</div></div>
              </div>
            )) : <div className="px-5 py-6 text-sm text-muted-fg">No unused levers — your deductions are maxed out.</div>}
          </div>
        </Card>
      </div>

      <div className={cn('mt-4 flex items-start gap-3 rounded-md border px-4 py-3 text-sm', c.switchRules.canSwitchEveryYear ? 'border-line bg-card' : 'border-c2/30 bg-c2/10 text-c2')}>
        <Info className="mt-0.5 size-4 shrink-0" /><span>{c.switchRules.note}</span><RuleChip ruleId={c.switchRules.ruleId} className="ml-auto" />
      </div>
    </div>
  );
}
