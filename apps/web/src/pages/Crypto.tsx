import type { VdaSummary } from '@fiscai/tax-engine';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { RuleChip } from '../components/RuleChip';
import { Button, Card, CardHeader, cn, ErrorNote, Input, MoneyInput, PageHeader, Skeleton, Stat, useToast } from '../components/ui';
import { api } from '../lib/api';
import { inr } from '../lib/format';
import { useInvalidateProfile, useTY } from '../lib/queries';

export default function Crypto() {
  const ty = useTY();
  const inv = useInvalidateProfile();
  const toast = useToast();
  const q = useQuery({ queryKey: ['vda', ty], queryFn: () => api<VdaSummary>(`/vda/${ty}`) });
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { if (q.data) setRows(q.data.txns.map(({ gain: _g, tax: _t, ...r }) => r)); }, [q.data]);
  const save = useMutation({ mutationFn: () => api(`/vda/${ty}`, { method: 'PUT', body: { txns: rows } }), onSuccess: async () => { await inv(); toast('Crypto transactions saved'); } });
  if (q.isLoading || !q.data) return <Skeleton className="h-96" />;
  const s = q.data;
  const set = (i: number, k: string, v: unknown) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div>
      <PageHeader label="F15 · Crypto (VDA)" title="Flat 30%, no set-off" description="Each profitable transfer is taxed at 30% plus cess. Losses don't reduce other gains and can't be carried forward. The 1% TDS deducted by exchanges is credited against your tax."
        actions={<Button icon={<Save className="size-3.5" />} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>} />
      <div className="grid grid-cols-2 gap-4 rounded-[0.625rem] border border-line bg-card p-5 md:grid-cols-4">
        <Stat label="Gains taxed" value={inr(s.totalGains)} />
        <Stat label="Losses ignored" value={inr(s.totalLossesIgnored)} tone={s.totalLossesIgnored ? 'danger' : undefined} />
        <Stat label="Tax @30% + cess" value={inr(s.tax + s.cess)} tone="orange" />
        <Stat label="TDS credit" value={inr(s.tdsCredit)} sub={s.tdsGap > 0 ? `Expected ≈ ${inr(s.expectedTds)} — check AIS` : 'Matches 1% of sales'} tone="lime" />
      </div>
      <Card className="mt-4 overflow-x-auto">
        <CardHeader label="Transfers" title="Sales and swaps" action={<RuleChip ruleId="VDA-30" />} />
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-line text-left text-muted-fg">{['Asset', 'Bought', 'Sold', 'Cost', 'Sale value', 'TDS', 'Gain', ''].map((h) => <th key={h} className="label-mono px-3 py-2.5 font-normal first:pl-5">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => {
              const g = (r.saleValue || 0) - (r.cost || 0);
              return (
                <tr key={i}>
                  <td className="py-2 pl-5 pr-2"><Input className="h-8" value={r.asset} onChange={(e) => { set(i, 'asset', e.target.value); set(i, 'label', e.target.value); }} /></td>
                  <td className="px-2"><Input className="h-8" type="date" value={r.buyDate ?? ''} onChange={(e) => set(i, 'buyDate', e.target.value)} /></td>
                  <td className="px-2"><Input className="h-8" type="date" value={r.sellDate ?? ''} onChange={(e) => set(i, 'sellDate', e.target.value)} /></td>
                  <td className="px-2"><MoneyInput value={r.cost} onChange={(v) => set(i, 'cost', v)} /></td>
                  <td className="px-2"><MoneyInput value={r.saleValue} onChange={(v) => set(i, 'saleValue', v)} /></td>
                  <td className="px-2"><MoneyInput value={r.tdsDeducted} onChange={(v) => set(i, 'tdsDeducted', v)} /></td>
                  <td className={cn('px-2 tabular', g >= 0 ? 'text-lime' : 'text-danger')}>{inr(g)}</td>
                  <td className="px-2"><button className="text-muted-fg hover:text-danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t border-line p-3"><Button size="sm" variant="secondary" icon={<Plus className="size-3" />} onClick={() => setRows([...rows, { label: '', asset: '', cost: 0, saleValue: 0, tdsDeducted: 0 }])}>Add transfer</Button></div>
      </Card>
      <div className="mt-4 space-y-1.5">{s.notes.map((n) => <p key={n} className="text-xs text-muted-fg">• {n}</p>)}</div>
      <ErrorNote error={save.error} />
    </div>
  );
}
