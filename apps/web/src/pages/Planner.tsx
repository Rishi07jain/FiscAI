import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { BellRing, Check, CircleDashed, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { RuleChip } from '../components/RuleChip';
import { Button, Card, CardHeader, Chip, cn, ErrorNote, Field, Input, MoneyInput, PageHeader, Skeleton, Stat, Tabs, useToast } from '../components/ui';
import { api } from '../lib/api';
import { daysUntil, fmtDate, inr, todayISO } from '../lib/format';
import { useAdvanceTax, useDeadlines, useInvalidateProfile, useProfile, useTY, type Deadline } from '../lib/queries';

function AdvanceTax() {
  const ty = useTY();
  const plan = useAdvanceTax();
  const profile = useProfile();
  const inv = useInvalidateProfile();
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState(0);
  const pay = useMutation({ mutationFn: () => api(`/advance-tax/${ty}/payments`, { body: { date, amount } }), onSuccess: async () => { setAmount(0); await inv(); toast('Payment logged'); } });
  const delPay = useMutation({ mutationFn: (i: number) => api(`/advance-tax/${ty}/payments/${i}`, { method: 'DELETE' }), onSuccess: () => inv() });
  if (plan.isLoading || !plan.data) return <Skeleton className="h-72" />;
  const p = plan.data;
  const payments = profile.data?.profile.taxesPaid.advancePayments ?? [];
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <Stat label="Estimated tax" value={inr(p.estimatedTax)} />
          <Stat label="TDS / TCS" value={inr(p.tdsTcs)} />
          <Stat label="Advance tax liability" value={inr(p.netLiability)} tone={p.required ? 'orange' : undefined} />
          <Stat label="Interest if unchanged" value={inr(p.totalInterest)} tone={p.totalInterest ? 'danger' : 'lime'} sub={`234B ${inr(p.interest234B)} · 234C ${inr(p.interest234C)}`} />
        </div>
        <div className={cn('mt-5 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm', p.required ? 'border-c2/30 bg-c2/10 text-c2' : 'border-lime/30 bg-lime-soft text-lime')}>
          <span>{p.reason}{p.required && p.tdsTcs === 0 && <> If your employer deducts tax from your salary every month, add that TDS in your profile — you may not need to pay advance tax yourself.</>}</span><span className="ml-auto flex gap-1.5">{p.ruleIds.map((r) => <RuleChip key={r} ruleId={r} />)}</span>
        </div>
      </Card>

      <Card>
        <CardHeader label="Instalments" title="15% · 45% · 75% · 100%" />
        <div className="grid gap-px bg-line md:grid-cols-4">
          {p.instalments.map((i, k) => {
            const ratio = i.requiredCumulative ? Math.min(1, i.paidCumulative / i.requiredCumulative) : 1;
            return (
              <div key={i.dueDate} className={cn('bg-card p-5', i.status === 'due' && 'bg-card-2')}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-fg">{Math.round(i.cumulativePct * 100)}% by</span>
                  <Chip tone={i.status === 'paid' ? 'lime' : i.status === 'short' ? 'danger' : i.status === 'due' ? 'orange' : 'muted'}>{i.status}</Chip>
                </div>
                <div className="mt-1 text-lg">{fmtDate(i.dueDate, { day: 'numeric', month: 'short' })}</div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><motion.div className={cn('h-full', ratio >= 1 ? 'bg-lime' : 'bg-c2')} initial={{ width: 0 }} animate={{ width: `${ratio * 100}%` }} transition={{ delay: k * 0.08 }} /></div>
                <div className="mt-2 text-xs text-muted-fg">Paid {inr(i.paidCumulative)} of {inr(i.requiredCumulative)}</div>
                {i.amountDueNow > 0 && p.required && <div className="mt-1 text-sm text-c2">Pay {inr(i.amountDueNow)}</div>}
                {i.interest234C > 0 && <div className="mt-1 text-xs text-danger">234C: {inr(i.interest234C)}</div>}
              </div>
            );
          })}
        </div>
        <div className="border-t border-line px-5 py-3 text-xs text-muted-fg">Capital gains are counted only from the instalment after the sale, so gains made after a due date carry no interest for the missed instalment. 234B assumes you file by {fmtDate(p.assumedFilingDate)}.</div>
      </Card>

      <Card>
        <CardHeader label="Payments" title="Log advance tax you've paid" />
        <div className="grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="Date paid"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Amount (challan 280)"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Button className="self-end" disabled={!amount} loading={pay.isPending} icon={<Plus className="size-3.5" />} onClick={() => pay.mutate()}>Log</Button>
        </div>
        {payments.length > 0 && (
          <div className="divide-y divide-line border-t border-line">
            {payments.map((x, i) => <div key={i} className="flex items-center justify-between px-5 py-2.5 text-sm"><span className="text-muted-fg">{fmtDate(x.date)}</span><span className="flex items-center gap-3 tabular">{inr(x.amount)}<button className="text-muted-fg hover:text-danger" onClick={() => delPay.mutate(i)}><Trash2 className="size-3.5" /></button></span></div>)}
          </div>
        )}
        <ErrorNote error={pay.error} />
      </Card>
    </div>
  );
}

function Deadlines() {
  const ty = useTY();
  const qc = useQueryClient();
  const d = useDeadlines();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(todayISO());
  const [show, setShow] = useState<'open' | 'all'>('open');
  const patch = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api(`/deadlines/${id}`, { method: 'PATCH', body: { status } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['deadlines'] }) });
  const add = useMutation({ mutationFn: () => api('/deadlines', { body: { taxYear: ty, title, dueDate: due } }), onSuccess: () => { setTitle(''); qc.invalidateQueries({ queryKey: ['deadlines'] }); } });
  const del = useMutation({ mutationFn: (id: string) => api(`/deadlines/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['deadlines'] }) });
  if (d.isLoading || !d.data) return <Skeleton className="h-72" />;
  const list = d.data.deadlines.filter((x) => (show === 'open' ? x.status === 'open' : true));
  const today = todayISO();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><Tabs value={show} onChange={setShow} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} /><span className="flex items-center gap-1.5 text-xs text-muted-fg"><BellRing className="size-3.5" />Email reminders 30, 7 and 1 day before</span></div>
      <Card>
        <div className="relative">
          <div className="absolute bottom-0 left-[1.65rem] top-0 w-px bg-line" />
          {list.map((x: Deadline, i) => {
            const days = daysUntil(x.dueDate);
            const past = x.dueDate < today;
            return (
              <motion.div key={x.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="relative flex items-start gap-4 border-b border-line px-5 py-4 last:border-b-0">
                <div className={cn('relative z-10 mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border bg-card', x.status === 'done' ? 'border-lime bg-lime text-black' : past ? 'border-danger text-danger' : days <= 30 ? 'border-c2 text-c2' : 'border-line-strong text-muted-fg')}>
                  {x.status === 'done' ? <Check className="size-3" /> : <CircleDashed className="size-3" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={cn('text-sm', x.status !== 'open' && 'text-muted-fg line-through')}>{x.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-fg">
                    <span className={cn(past && x.status === 'open' && 'text-danger', !past && days <= 30 && 'text-c2')}>{fmtDate(x.dueDate)} · {past ? `${-days} days ago` : days === 0 ? 'today' : `in ${days} days`}</span>
                    {x.amount ? <span>· {inr(x.amount)}</span> : null}
                    <Chip tone="muted">{x.origin}</Chip>
                    {x.ruleId && <RuleChip ruleId={x.ruleId} />}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {x.status === 'open' ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => patch.mutate({ id: x.id, status: 'done' })}>Done</Button>
                      <button className="p-1.5 text-muted-fg hover:text-fg" title="Dismiss" onClick={() => patch.mutate({ id: x.id, status: 'dismissed' })}><X className="size-3.5" /></button>
                    </>
                  ) : <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: x.id, status: 'open' })}>Reopen</Button>}
                  {x.origin === 'custom' && <button className="p-1.5 text-muted-fg hover:text-danger" onClick={() => del.mutate(x.id)}><Trash2 className="size-3.5" /></button>}
                </div>
              </motion.div>
            );
          })}
          {!list.length && <div className="px-5 py-8 text-center text-sm text-muted-fg">No deadlines here.</div>}
        </div>
      </Card>
      <Card className="p-5">
        <div className="label-mono mb-3 text-muted-fg">Add your own</div>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
          <Input placeholder="e.g. Pay LIC premium" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <Button disabled={!title} loading={add.isPending} onClick={() => add.mutate()} icon={<Plus className="size-3.5" />}>Add</Button>
        </div>
      </Card>
    </div>
  );
}

export default function Planner() {
  const [tab, setTab] = useState<'advance' | 'deadlines'>('advance');
  return (
    <div>
      <PageHeader label="F9 · F11 · Year-round planner" title={<>Act <span className="text-lime">before</span> the deadline</>} description="Advance tax due on each instalment, the interest for missing one, and every personal deadline generated from your events — 54EC windows, CGAS deposits, ITR dates by form, revised returns, timely ITR-3 for F&O losses." />
      <Tabs value={tab} onChange={setTab} options={[{ value: 'advance', label: 'Advance tax' }, { value: 'deadlines', label: 'Deadlines' }]} className="mb-4" />
      {tab === 'advance' ? <AdvanceTax /> : <Deadlines />}
    </div>
  );
}
