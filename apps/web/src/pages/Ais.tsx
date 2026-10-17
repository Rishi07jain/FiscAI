import type { AisMismatch } from '@fiscai/tax-engine';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileUp, Info, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RuleChip } from '../components/RuleChip';
import { Button, Card, CardHeader, Chip, cn, EmptyState, Input, MoneyInput, PageHeader, Select, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { inr } from '../lib/format';
import { useTY } from '../lib/queries';

const CATS = ['salary', 'interest_savings', 'interest_fd', 'dividend', 'sale_securities', 'sale_mf', 'rent_received', 'vda_transfer', 'tds', 'tcs', 'other'];

export default function Ais() {
  const ty = useTY();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ais', ty], queryFn: () => api<{ entries: any[]; items: AisMismatch[]; highCount: number }>(`/ais/${ty}`) });
  const [e, setE] = useState({ category: 'interest_fd', source: '', amount: 0, tds: 0 });
  const add = useMutation({ mutationFn: () => api('/ais/entries', { body: { ...e, taxYear: ty } }), onSuccess: () => { setE({ ...e, source: '', amount: 0, tds: 0 }); qc.invalidateQueries({ queryKey: ['ais'] }); } });
  const del = useMutation({ mutationFn: (id: string) => api(`/ais/entries/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ais'] }) });
  if (q.isLoading || !q.data) return <Skeleton className="h-96" />;
  const d = q.data;
  return (
    <div>
      <PageHeader label="F14 · AIS reconciliation" title="Catch notices before they happen" description="Matches what the department already knows (AIS) against your profile and flags gaps — unreported interest or a mismatched sale value are the most common triggers."
        actions={<Link to="/documents"><Button variant="secondary" icon={<FileUp className="size-3.5" />}>Upload AIS (JSON / PDF)</Button></Link>} />
      {d.items.length ? (
        <Card>
          <CardHeader label="Reconciliation" title={d.highCount ? `${d.highCount} gap${d.highCount > 1 ? 's' : ''} to fix` : 'Everything matches'} action={<RuleChip ruleId="AIS" />} />
          <div className="divide-y divide-line">
            {d.items.map((i) => (
              <div key={i.category} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto]">
                <div className="flex items-start gap-3">
                  {i.severity === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 text-lime" /> : i.severity === 'high' ? <AlertTriangle className="mt-0.5 size-4 text-danger" /> : <Info className="mt-0.5 size-4 text-c2" />}
                  <div><div className="text-sm font-medium">{i.label}</div><div className="mt-0.5 text-xs text-muted-fg">{i.message}</div></div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-right text-sm tabular">
                  <div><div className="label-mono text-muted-fg">AIS</div>{inr(i.aisAmount)}</div>
                  <div><div className="label-mono text-muted-fg">Yours</div>{inr(i.profileAmount)}</div>
                  <div><div className="label-mono text-muted-fg">Gap</div><span className={cn(i.severity === 'high' && 'text-danger', i.severity === 'low' && 'text-c2')}>{inr(i.difference, { sign: true })}</span></div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : <Card><EmptyState icon={<FileUp className="size-5" />} title="No AIS data yet" body="Download your AIS JSON from the e-filing portal and upload it, or add entries manually below." /></Card>}

      <Card className="mt-4">
        <CardHeader label="AIS entries" title={`${d.entries.length} reported items`} />
        <div className="divide-y divide-line">
          {d.entries.map((x) => <div key={x.id} className="flex items-center gap-3 px-5 py-2.5 text-sm"><Chip tone="muted">{x.category.replace('_', ' ')}</Chip><span className="flex-1 truncate text-muted-fg">{x.source}</span><span className="tabular">{inr(x.amount)}</span>{x.tds ? <span className="text-xs text-muted-fg">TDS {inr(x.tds)}</span> : null}<button className="text-muted-fg hover:text-danger" onClick={() => del.mutate(x.id)}><Trash2 className="size-3.5" /></button></div>)}
        </div>
        <div className="grid gap-2 border-t border-line p-4 sm:grid-cols-[180px_1fr_1fr_1fr_auto]">
          <Select value={e.category} onChange={(x) => setE({ ...e, category: x.target.value })}>{CATS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</Select>
          <Input placeholder="Source (bank, company)" value={e.source} onChange={(x) => setE({ ...e, source: x.target.value })} />
          <MoneyInput value={e.amount} onChange={(v) => setE({ ...e, amount: v })} placeholder="Amount" />
          <MoneyInput value={e.tds} onChange={(v) => setE({ ...e, tds: v })} placeholder="TDS" />
          <Button disabled={!e.amount} loading={add.isPending} icon={<Plus className="size-3.5" />} onClick={() => add.mutate()}>Add</Button>
        </div>
      </Card>
    </div>
  );
}
