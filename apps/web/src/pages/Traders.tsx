import type { FnoSummary } from '@fiscai/tax-engine';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Plus, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CompareBars } from '../components/charts';
import { RuleChip } from '../components/RuleChip';
import { Button, Card, CardHeader, Chip, cn, ErrorNote, Field, Input, MoneyInput, PageHeader, Select, Skeleton, Stat, useToast } from '../components/ui';
import { api } from '../lib/api';
import { fmtDate, inr, todayISO } from '../lib/format';
import { useInvalidateProfile, useTY } from '../lib/queries';

interface Resp { trades: any[]; summary: FnoSummary; priorLosses: { id: string; year: string; loss: number }[] }

export default function Traders() {
  const ty = useTY();
  const qc = useQueryClient();
  const inv = useInvalidateProfile();
  const toast = useToast();
  const q = useQuery({ queryKey: ['fno', ty], queryFn: () => api<Resp>(`/fno/${ty}`) });
  const [t, setT] = useState({ date: todayISO(), symbol: '', segment: 'FUT', pnl: 0, sellValue: 0, charges: 0 });
  const [loss, setLoss] = useState({ year: '2025-26', loss: 0 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['fno'] });
  const add = useMutation({ mutationFn: () => api('/fno/trades', { body: { ...t, taxYear: ty } }), onSuccess: () => { setT({ ...t, symbol: '', pnl: 0, sellValue: 0, charges: 0 }); refresh(); } });
  const del = useMutation({ mutationFn: (id: string) => api(`/fno/trades/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const addLoss = useMutation({ mutationFn: () => api('/fno/prior-losses', { body: loss }), onSuccess: refresh });
  const delLoss = useMutation({ mutationFn: (id: string) => api(`/fno/prior-losses/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const apply = useMutation({ mutationFn: () => api(`/fno/${ty}/apply`, { method: 'POST' }), onSuccess: async () => { await inv(); toast('F&O and intraday totals saved to your profile'); } });
  if (q.isLoading || !q.data) return <Skeleton className="h-96" />;
  const s = q.data.summary;
  return (
    <div>
      <PageHeader label="F12 · F&O & trader module" title="Your real post-tax, post-STT profit" description="Turnover, net profit after charges and STT, audit applicability, loss carry-forward by year, and what the Budget 2026 STT increase costs on your own trades."
        actions={<><Link to="/documents"><Button variant="secondary" icon={<FileUp className="size-3.5" />}>Import broker P&L</Button></Link><Button icon={<Send className="size-3.5" />} loading={apply.isPending} onClick={() => apply.mutate()}>Use in my tax</Button></>} />
      <div className="grid grid-cols-2 gap-4 rounded-[0.625rem] border border-line bg-card p-5 md:grid-cols-4">
        <Stat label="F&O turnover" value={inr(s.fno.turnover, { compact: true })} sub="sum of absolute P&L" />
        <Stat label="Gross P&L" value={inr(s.fno.grossPnl)} tone={s.fno.grossPnl >= 0 ? 'lime' : 'danger'} />
        <Stat label="Charges + STT" value={inr(s.fno.charges + s.fno.stt)} />
        <Stat label="Net profit / (loss)" value={inr(s.fno.netProfit)} tone={s.fno.netProfit >= 0 ? 'lime' : 'danger'} sub={`Intraday net ${inr(s.intraday.netProfit)}`} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader label="Budget 2026" title="STT increase on your trades" action={<RuleChip ruleId="FNO-STT-2026" />} />
          <div className="p-5">
            <CompareBars items={[{ label: 'At old rates (0.02% / 0.10%)', value: s.sttImpact.oldRates }, { label: 'At new rates (0.05% / 0.15%)', value: s.sttImpact.newRates, highlight: true }]} />
            <div className="mt-4 text-sm">Extra cost: <span className="text-c2">{inr(s.sttImpact.increase)}</span> <span className="text-muted-fg">from {fmtDate(s.sttImpact.effectiveFrom)}</span></div>
          </div>
        </Card>
        <Card>
          <CardHeader label="Audit" title={s.audit.required ? 'Tax audit required' : 'No audit on turnover'} action={<RuleChip ruleId="FNO-BUSINESS" />} />
          <div className="p-5 text-sm text-muted-fg"><Chip tone={s.audit.required ? 'danger' : 'lime'}>{s.audit.required ? 'Audit' : 'Within limit'}</Chip><p className="mt-3">{s.audit.reason}</p><p className="mt-2">File {s.itrForm} by 31 August (non-audit) to keep losses.</p></div>
        </Card>
        <Card>
          <CardHeader label="Carry forward" title="Business losses (8 years)" />
          <div className="divide-y divide-line">
            {s.carryForward.map((c, i) => <div key={i} className="flex items-center justify-between px-5 py-2.5 text-sm"><span>TY {c.year}</span><span className="tabular text-danger">{inr(c.loss)}</span><span className="text-xs text-muted-fg">until {c.expiresAfter}</span>{q.data.priorLosses.find((p) => p.year === c.year && p.loss === c.loss) && <button onClick={() => delLoss.mutate(q.data.priorLosses.find((p) => p.year === c.year)!.id)} className="text-muted-fg hover:text-danger"><Trash2 className="size-3" /></button>}</div>)}
            {!s.carryForward.length && <div className="px-5 py-3 text-sm text-muted-fg">No losses to carry forward.</div>}
          </div>
          <div className="flex gap-2 border-t border-line p-3"><Input className="h-8 w-24" value={loss.year} onChange={(e) => setLoss({ ...loss, year: e.target.value })} placeholder="2024-25" /><MoneyInput className="flex-1" value={loss.loss} onChange={(v) => setLoss({ ...loss, loss: v })} /><Button size="sm" variant="secondary" disabled={!loss.loss} onClick={() => addLoss.mutate()}>Add prior</Button></div>
        </Card>
      </div>
      <Card className="mt-4 overflow-x-auto">
        <CardHeader label="Trades" title={`${s.trades} realised trades`} />
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-line text-left text-muted-fg"><th className="label-mono px-5 py-2.5 font-normal">Date</th><th className="label-mono px-3 font-normal">Instrument</th><th className="label-mono px-3 font-normal">Segment</th><th className="label-mono px-3 font-normal">P&L</th><th className="label-mono px-3 font-normal">Sell value / premium</th><th className="label-mono px-3 font-normal">Charges</th><th /></tr></thead>
          <tbody className="divide-y divide-line">
            {q.data.trades.map((x) => <tr key={x.id}><td className="px-5 py-2.5 text-muted-fg">{fmtDate(x.date)}</td><td className="px-3">{x.symbol}</td><td className="px-3"><Chip tone="muted">{x.segment}</Chip></td><td className={cn('px-3 tabular', x.pnl >= 0 ? 'text-lime' : 'text-danger')}>{inr(x.pnl)}</td><td className="px-3 tabular">{inr(x.sellValue)}</td><td className="px-3 tabular">{inr(x.charges ?? 0)}</td><td className="px-3 text-right"><button className="text-muted-fg hover:text-danger" onClick={() => del.mutate(x.id)}><Trash2 className="size-3.5" /></button></td></tr>)}
          </tbody>
        </table>
        <div className="grid gap-2 border-t border-line p-4 sm:grid-cols-[130px_1fr_120px_1fr_1fr_1fr_auto]">
          <Input type="date" value={t.date} onChange={(e) => setT({ ...t, date: e.target.value })} />
          <Input placeholder="NIFTY 24500 CE" value={t.symbol} onChange={(e) => setT({ ...t, symbol: e.target.value })} />
          <Select value={t.segment} onChange={(e) => setT({ ...t, segment: e.target.value })}><option value="FUT">Futures</option><option value="OPT">Options</option><option value="INTRADAY_EQ">Intraday equity</option></Select>
          <MoneyInput value={t.pnl} allowNegative onChange={(v) => setT({ ...t, pnl: v })} placeholder="P&L (− for loss)" />
          <MoneyInput value={t.sellValue} onChange={(v) => setT({ ...t, sellValue: v })} placeholder="Sell value" />
          <MoneyInput value={t.charges} onChange={(v) => setT({ ...t, charges: v })} placeholder="Charges" />
          <Button disabled={!t.symbol} loading={add.isPending} icon={<Plus className="size-3.5" />} onClick={() => add.mutate()}>Add</Button>
        </div>
        <ErrorNote error={add.error} />
      </Card>
    </div>
  );
}
