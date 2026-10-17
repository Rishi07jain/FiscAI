import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { FileUp, FlaskConical, Hourglass, Plus, RefreshCw, Sprout, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RuleChip } from '../components/RuleChip';
import { Button, Card, CardHeader, Chip, cn, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Skeleton, Stat, Tabs, useToast } from '../components/ui';
import { api } from '../lib/api';
import { fmtDate, inr, todayISO } from '../lib/format';
import { useHarvest, useInvalidateProfile, useLots, usePortfolio, useTY } from '../lib/queries';

function AddLot({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ symbol: '', assetType: 'listed_equity', qty: 10, buyDate: todayISO(), buyPrice: 0, currentPrice: 0, sold: false, sellDate: todayISO(), sellPrice: 0 });
  const add = useMutation({
    mutationFn: () => api('/portfolio/lots', { body: { symbol: f.symbol, assetType: f.assetType, qty: f.qty, buyDate: f.buyDate, buyPrice: f.buyPrice, currentPrice: f.currentPrice || undefined, ...(f.sold ? { sellDate: f.sellDate, sellPrice: f.sellPrice } : {}) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['portfolio'] }); qc.invalidateQueries({ queryKey: ['harvest'] }); onClose(); },
  });
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  return (
    <Modal open={open} onClose={onClose} title="Add a lot">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Symbol / fund"><Input value={f.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase())} /></Field>
        <Field label="Type"><Select value={f.assetType} onChange={(e) => set('assetType', e.target.value)}><option value="listed_equity">Listed shares</option><option value="equity_mf">Equity MF</option><option value="debt_mf">Debt MF</option><option value="sgb">SGB</option><option value="gold">Gold</option></Select></Field>
        <Field label="Quantity"><Input type="number" value={f.qty} onChange={(e) => set('qty', Number(e.target.value))} /></Field>
        <Field label="Buy date"><Input type="date" value={f.buyDate} onChange={(e) => set('buyDate', e.target.value)} /></Field>
        <Field label="Buy price / unit"><Input type="number" value={f.buyPrice} onChange={(e) => set('buyPrice', Number(e.target.value))} /></Field>
        <Field label="Current price / unit"><Input type="number" value={f.currentPrice} onChange={(e) => set('currentPrice', Number(e.target.value))} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="accent-[var(--primary)]" checked={f.sold} onChange={(e) => set('sold', e.target.checked)} />This is a sale (FIFO-matched against older buys)</label>
        {f.sold && <><Field label="Sell date"><Input type="date" value={f.sellDate} onChange={(e) => set('sellDate', e.target.value)} /></Field><Field label="Sell price / unit"><Input type="number" value={f.sellPrice} onChange={(e) => set('sellPrice', Number(e.target.value))} /></Field></>}
      </div>
      <ErrorNote error={add.error} />
      <div className="mt-5 flex justify-end"><Button loading={add.isPending} disabled={!f.symbol} onClick={() => add.mutate()}>Add</Button></div>
    </Modal>
  );
}

export default function Portfolio() {
  const ty = useTY();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const inv = useInvalidateProfile();
  const p = usePortfolio();
  const lots = useLots();
  const h = useHarvest();
  const [tab, setTab] = useState<'holdings' | 'harvest' | 'realised'>('holdings');
  const [adding, setAdding] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const savePrices = useMutation({
    mutationFn: () => api('/portfolio/prices', { body: { prices: Object.fromEntries(Object.entries(prices).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])) } }),
    onSuccess: () => { setPrices({}); qc.invalidateQueries({ queryKey: ['portfolio'] }); qc.invalidateQueries({ queryKey: ['harvest'] }); toast('Prices updated'); },
  });
  const sync = useMutation({ mutationFn: () => api('/portfolio/sync', { body: { taxYear: ty } }), onSuccess: async (r: any) => { await inv(); toast(`${r.synced} realised sale(s) synced to your Tax Year ${ty} profile`); } });
  const delLot = useMutation({ mutationFn: (id: string) => api(`/portfolio/lots/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['portfolio'] }); qc.invalidateQueries({ queryKey: ['harvest'] }); } });

  if (p.isLoading) return <Skeleton className="h-96" />;
  if (p.error) return <ErrorNote error={p.error} />;
  const v = p.data!;
  const lotId = (symbol: string, buyDate: string) => lots.data?.lots.find((l) => l.symbol === symbol && l.buyDate === buyDate && !l.sellDate)?.id;
  const whatIf = (symbol: string, assetType: string) => {
    const mine = v.holdings.filter((x) => x.symbol === symbol);
    const qty = mine.reduce((s, x) => s + x.qty, 0);
    const price = mine[0]?.currentPrice ?? mine[0]?.buyPrice ?? 0;
    const inputs = { symbol, assetType: assetType === 'equity_mf' ? 'equity_mf' : 'listed_equity', lots: mine.map((x) => ({ qty: x.qty, buyDate: x.buyDate, buyPrice: x.buyPrice })), qty, price, date: todayISO() };
    nav(`/scenarios?type=sell_equity&inputs=${encodeURIComponent(JSON.stringify(inputs))}`);
  };
  const dirtyPrices = Object.values(prices).some((x) => x !== '');

  return (
    <div>
      <PageHeader label="F7 · Portfolio & holding periods" title="Portfolio" description="Lot-level holdings matched FIFO. See unrealised gains split into short- and long-term, and which lots are about to turn long-term."
        actions={<><Link to="/documents"><Button variant="secondary" icon={<FileUp className="size-3.5" />}>Import broker / CAS</Button></Link><Button variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Add lot</Button><Button icon={<RefreshCw className="size-3.5" />} loading={sync.isPending} onClick={() => sync.mutate()}>Sync sales to profile</Button></>} />

      <div className="grid grid-cols-2 gap-4 rounded-[0.625rem] border border-line bg-card p-5 md:grid-cols-3 2xl:grid-cols-6">
        <Stat label="Invested" value={inr(v.totals.cost, { compact: true })} />
        <Stat label="Current value" value={inr(v.totals.value, { compact: true })} />
        <Stat label="Unrealised ST" value={inr(v.totals.unrealisedST, { compact: true })} tone={v.totals.unrealisedST >= 0 ? 'orange' : 'danger'} sub="taxed 20% if sold" />
        <Stat label="Unrealised LT" value={inr(v.totals.unrealisedLT, { compact: true })} tone="lime" sub="12.5% above 1.25L" />
        <Stat label="Realised ST (TY)" value={inr(v.totals.realisedST, { compact: true })} />
        <Stat label="Realised LT (TY)" value={inr(v.totals.realisedLT, { compact: true })} sub={`${v.syncedToProfile} synced to profile`} />
      </div>

      {v.countdown.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {v.countdown.map((c) => (
            <motion.div key={c.key} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
              <Card className="flex items-center gap-4 border-c2/30 p-4">
                <div className="grid size-12 shrink-0 place-items-center rounded-lg border border-c2/30 bg-c2/10 text-c2"><div className="text-center leading-none"><div className="text-lg font-medium">{c.daysToLongTerm}</div><div className="font-mono text-[0.5rem]">DAYS</div></div></div>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">{c.symbol} × {c.qty}</div>
                  <div className="text-xs text-muted-fg">Long-term from {fmtDate(c.longTermOn)}{c.waitSaving ? <> · <span className="text-lime">{inr(c.waitSaving)} less tax if you wait</span></> : null}</div>
                </div>
                <Hourglass className="size-4 text-c2" />
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <Tabs value={tab} onChange={setTab} options={[{ value: 'holdings', label: `Holdings (${v.holdings.length})` }, { value: 'harvest', label: 'Harvesting' }, { value: 'realised', label: `Realised (${v.realised.length})` }]} />
        {tab === 'holdings' && dirtyPrices && <Button size="sm" loading={savePrices.isPending} onClick={() => savePrices.mutate()}>Save prices</Button>}
      </div>

      {tab === 'holdings' && (
        <Card className="mt-3 overflow-x-auto">
          {v.holdings.length ? (
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="border-b border-line text-left"><th className="label-mono px-5 py-3 font-normal text-muted-fg">Holding</th><th className="label-mono px-3 font-normal text-muted-fg">Qty</th><th className="label-mono px-3 font-normal text-muted-fg">Bought</th><th className="label-mono px-3 font-normal text-muted-fg">Cost</th><th className="label-mono px-3 font-normal text-muted-fg">Price now</th><th className="label-mono px-3 font-normal text-muted-fg">Unrealised</th><th className="label-mono px-3 font-normal text-muted-fg">Term</th><th /></tr></thead>
              <tbody className="divide-y divide-line">
                {v.holdings.map((x) => (
                  <tr key={x.key} className="hover:bg-card-2/60">
                    <td className="px-5 py-3"><div className="font-medium">{x.symbol}</div><div className="text-xs text-muted-fg">{x.assetType.replace('_', ' ')}</div></td>
                    <td className="px-3 tabular">{x.qty}</td>
                    <td className="px-3 text-muted-fg">{fmtDate(x.buyDate)}</td>
                    <td className="px-3 tabular">{inr(x.cost)}</td>
                    <td className="px-3"><Input className="h-8 w-24 tabular" placeholder={x.currentPrice?.toString() ?? '—'} value={prices[x.symbol] ?? ''} onChange={(e) => setPrices({ ...prices, [x.symbol]: e.target.value })} /></td>
                    <td className={cn('px-3 tabular', (x.unrealised ?? 0) >= 0 ? 'text-lime' : 'text-danger')}>{x.unrealised === null ? '—' : inr(x.unrealised)}</td>
                    <td className="px-3">{x.term === 'long' ? <Chip tone="lime">Long</Chip> : <span className="inline-flex items-center gap-1.5"><Chip tone="orange">Short</Chip>{x.daysToLongTerm !== null && <span className="text-xs text-muted-fg">{x.daysToLongTerm}d</span>}</span>}</td>
                    <td className="px-3 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" icon={<FlaskConical className="size-3" />} onClick={() => whatIf(x.symbol, x.assetType)}>What if I sell?</Button>
                      {lotId(x.symbol, x.buyDate) && <button className="ml-1 p-1 text-muted-fg hover:text-danger" onClick={() => delLot.mutate(lotId(x.symbol, x.buyDate)!)} aria-label="Delete lot"><Trash2 className="size-3.5" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon={<FileUp className="size-5" />} title="No holdings yet" body="Import a broker tradebook / P&L or a mutual fund CAS, or add lots by hand." />}
        </Card>
      )}

      {tab === 'harvest' && (
        <div className="mt-3 space-y-4">
          {h.data && (
            <>
              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="label-mono text-muted-fg">Rs 1.25 lakh equity LTCG exemption · Tax Year {ty}</div>
                    <div className="mt-2 text-2xl font-light">{inr(h.data.unusedExemption)} <span className="text-base text-muted-fg">unused</span></div>
                  </div>
                  <div className="flex items-center gap-2">{!h.data.season && <Chip tone="muted">Harvest season starts in January</Chip>}<RuleChip ruleId="CG-EQ-LTCG" /><RuleChip ruleId="CG-LOSS-SETOFF" /></div>
                </div>
                <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted"><motion.div className="h-full bg-lime" initial={{ width: 0 }} animate={{ width: `${(h.data.realisedEquityLTCG / h.data.exemption) * 100}%` }} /></div>
                <div className="mt-1.5 flex justify-between text-xs text-muted-fg"><span>Used: {inr(Math.min(h.data.exemption, h.data.realisedEquityLTCG))}</span><span>{inr(h.data.exemption)}</span></div>
              </Card>
              <Card>
                <CardHeader label="Tax effects" title="What booking these would do" />
                {h.data.candidates.length ? (
                  <div className="divide-y divide-line">
                    {h.data.candidates.map((c, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-4 px-5 py-4">
                        <Sprout className={cn('size-4', c.kind === 'ltcg_harvest' ? 'text-lime' : 'text-c2')} />
                        <div className="min-w-0 flex-1"><div className="text-sm font-medium">{c.symbol} · {c.qtyToBook} of {c.qty} units <Chip tone={c.kind === 'ltcg_harvest' ? 'lime' : 'orange'} className="ml-1">{c.kind === 'ltcg_harvest' ? 'LTCG harvest' : 'Loss harvest'}</Chip></div><div className="mt-0.5 text-xs text-muted-fg">{c.note}</div></div>
                        <div className="text-right text-sm"><div className="tabular">{inr(c.gainBooked)} {c.kind === 'ltcg_harvest' ? 'gain' : 'loss'}</div><div className="text-xs text-muted-fg">This year: <span className={c.taxEffectNow < 0 ? 'text-lime' : ''}>{inr(c.taxEffectNow, { sign: true })}</span>{c.futureTaxAvoided ? <> · future tax avoided ≈ {inr(c.futureTaxAvoided)}</> : null}</div></div>
                      </div>
                    ))}
                  </div>
                ) : <div className="px-5 py-6 text-sm text-muted-fg">No harvesting opportunities right now. Add current prices to your holdings to see them.</div>}
                <div className="border-t border-line px-5 py-3 text-xs text-muted-fg">{h.data.disclaimer}</div>
              </Card>
            </>
          )}
        </div>
      )}

      {tab === 'realised' && (
        <Card className="mt-3 overflow-x-auto">
          {v.realised.length ? (
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-line text-left text-muted-fg"><th className="label-mono px-5 py-3 font-normal">Sale</th><th className="label-mono px-3 font-normal">Bought</th><th className="label-mono px-3 font-normal">Sold</th><th className="label-mono px-3 font-normal">Cost</th><th className="label-mono px-3 font-normal">Sale value</th><th className="label-mono px-3 font-normal">Gain</th></tr></thead>
              <tbody className="divide-y divide-line">{v.realised.map((r, i) => { const g = r.saleValue - r.cost - r.expenses; return <tr key={i}><td className="px-5 py-2.5">{r.label}</td><td className="px-3 text-muted-fg">{fmtDate(r.buyDate)}</td><td className="px-3 text-muted-fg">{fmtDate(r.sellDate)}</td><td className="px-3 tabular">{inr(r.cost)}</td><td className="px-3 tabular">{inr(r.saleValue)}</td><td className={cn('px-3 tabular', g >= 0 ? 'text-lime' : 'text-danger')}>{inr(g)}</td></tr>; })}</tbody>
            </table>
          ) : <div className="px-5 py-6 text-sm text-muted-fg">No sales recorded in your lots.</div>}
        </Card>
      )}
      <AddLot open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
