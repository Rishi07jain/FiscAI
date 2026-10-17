import type { HouseholdView } from '@fiscai/tax-engine';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HeartPulse, Plus, ShieldAlert, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { RuleChip } from '../components/RuleChip';
import { Button, Card, CardHeader, Chip, EmptyState, ErrorNote, Field, Input, Modal, MoneyInput, PageHeader, Select, Skeleton, Stat } from '../components/ui';
import { api } from '../lib/api';
import { inr } from '../lib/format';
import { useTY } from '../lib/queries';

export default function Household() {
  const ty = useTY();
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ['household', ty], queryFn: () => api<HouseholdView>(`/household/${ty}`) });
  const members = useQuery({ queryKey: ['household', 'members'], queryFn: () => api<{ members: any[] }>('/household/members') });
  const [open, setOpen] = useState(false);
  const [m, setM] = useState({ name: '', relation: 'mother', ageBand: '60to79', salary: 0, fdInterest: 0, healthPremiumPaidByUser: 0, giftsFromUser: 0 });
  const add = useMutation({
    mutationFn: () => api('/household/members', { body: { name: m.name, relation: m.relation, ageBand: m.ageBand, healthPremiumPaidByUser: m.healthPremiumPaidByUser, giftsFromUser: m.giftsFromUser, profile: { salary: { basic: m.salary }, otherIncome: { fdInterest: m.fdInterest } } } }),
    onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ['household'] }); },
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/household/members/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['household'] }) });
  if (view.isLoading || !view.data) return <Skeleton className="h-96" />;
  const v = view.data;
  return (
    <div>
      <PageHeader label="F16 · Household view" title="Plan tax as a family" description="See each person's tax, plan who claims parents' health insurance, and get warned about clubbing rules on gifts." actions={<Button icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)}>Add member</Button>} />
      <div className="grid grid-cols-2 gap-4 rounded-[0.625rem] border border-line bg-card p-5 md:grid-cols-3">
        <Stat label="Your tax (best regime)" value={inr(v.user.tax[v.user.tax.best])} sub={`${v.user.tax.best} regime`} />
        <Stat label="Members" value={v.members.length} />
        <Stat label="Family tax" value={inr(v.familyTax)} tone="orange" />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {v.members.map((x, i) => (
          <Card key={i} className="p-5">
            <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-card-2"><UserRound className="size-4 text-muted-fg" /></div><div className="flex-1"><div className="font-medium">{x.name}</div><div className="text-xs capitalize text-muted-fg">{x.relation}</div></div>
              {members.data?.members[i] && <button className="text-muted-fg hover:text-danger" onClick={() => del.mutate(members.data!.members[i].id)}><Trash2 className="size-3.5" /></button>}</div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><div className="text-xs text-muted-fg">Income</div>{inr(x.totalIncome)}</div><div><div className="text-xs text-muted-fg">Tax ({x.tax.best})</div>{inr(x.tax[x.tax.best])}</div></div>
          </Card>
        ))}
        {!v.members.length && <Card className="md:col-span-2 lg:col-span-3"><EmptyState icon={<UserRound className="size-5" />} title="No family members yet" body="Add your spouse or parents to plan 80D and see clubbing effects." /></Card>}
      </div>
      {v.healthInsurance.length > 0 && (
        <Card className="mt-4"><CardHeader label="80D planning" title="Parents' health insurance" action={<RuleChip ruleId="DED-80D" />} />
          <div className="divide-y divide-line">{v.healthInsurance.map((h) => <div key={h.who} className="flex items-start gap-3 px-5 py-4 text-sm"><HeartPulse className="mt-0.5 size-4 text-c2" /><div className="flex-1"><div className="font-medium">{h.who} · premium {inr(h.premium)}</div><div className="mt-0.5 text-xs text-muted-fg">{h.note}</div></div>{h.saving > 0 && <Chip tone="lime">saves {inr(h.saving)}</Chip>}</div>)}</div>
        </Card>
      )}
      {v.clubbingWarnings.length > 0 && (
        <Card className="mt-4"><CardHeader label="Clubbing" title="Gifts and whose income it is" action={<RuleChip ruleId="CLUBBING" />} />
          <div className="divide-y divide-line">{v.clubbingWarnings.map((c, i) => <div key={i} className="flex items-start gap-3 px-5 py-3 text-sm"><ShieldAlert className="mt-0.5 size-4 text-warn" /><span><span className="font-medium">{c.member}:</span> <span className="text-muted-fg">{c.message}</span></span></div>)}</div>
        </Card>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add a family member">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><Input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} /></Field>
          <Field label="Relation"><Select value={m.relation} onChange={(e) => setM({ ...m, relation: e.target.value })}><option value="spouse">Spouse</option><option value="father">Father</option><option value="mother">Mother</option><option value="child">Child</option><option value="other">Other</option></Select></Field>
          <Field label="Age"><Select value={m.ageBand} onChange={(e) => setM({ ...m, ageBand: e.target.value })}><option value="below60">Below 60</option><option value="60to79">60 – 79</option><option value="80plus">80+</option></Select></Field>
          <Field label="Annual salary / pension"><MoneyInput value={m.salary} onChange={(v) => setM({ ...m, salary: v })} /></Field>
          <Field label="FD / savings interest"><MoneyInput value={m.fdInterest} onChange={(v) => setM({ ...m, fdInterest: v })} /></Field>
          <Field label="Health premium you pay for them"><MoneyInput value={m.healthPremiumPaidByUser} onChange={(v) => setM({ ...m, healthPremiumPaidByUser: v })} /></Field>
          <Field label="Money you've gifted them" className="sm:col-span-2"><MoneyInput value={m.giftsFromUser} onChange={(v) => setM({ ...m, giftsFromUser: v })} /></Field>
        </div>
        <ErrorNote error={add.error} />
        <div className="mt-5 flex justify-end"><Button disabled={!m.name} loading={add.isPending} onClick={() => add.mutate()}>Add</Button></div>
      </Modal>
    </div>
  );
}
