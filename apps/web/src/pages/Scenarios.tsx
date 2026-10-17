import { CITY_OPTIONS, type ScenarioType } from '@fiscai/shared-types';
import type { ScenarioResult } from '@fiscai/tax-engine';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Building2, CalendarClock, Check, Coins, GitCompare, Home, Landmark, PiggyBank, Play, Plus, Save, Scale, Trash2, TrendingUp, Trash } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RuleChip } from '../components/RuleChip';
import { AnimatedNumber, Button, Card, CardHeader, Chip, cn, EmptyState, ErrorNote, Field, Input, MoneyInput, PageHeader, Select, Switch, useToast } from '../components/ui';
import { api } from '../lib/api';
import { fmtDate, inr, SCENARIO_LABELS, todayISO } from '../lib/format';
import { useInvalidateProfile, useScenarios, useTY, type SavedScenario } from '../lib/queries';

type Result = Omit<ScenarioResult, 'afterProfile'>;

const ICONS: Record<ScenarioType, ReactNode> = {
  sell_equity: <TrendingUp />, sell_property: <Building2 />, home_loan: <Home />, salary_change: <Coins />, invest_deduction: <PiggyBank />, redeem_sgb: <Landmark />, buyback: <ArrowDownRight />, switch_regime: <Scale />,
};

const DEFAULTS: Record<ScenarioType, any> = {
  sell_equity: { symbol: '', assetType: 'listed_equity', lots: [{ qty: 40, buyDate: '2025-11-10', buyPrice: 1000 }], qty: 40, price: 1250, date: todayISO(), charges: 0 },
  sell_property: { label: 'Flat', assetType: 'property', isResidentialHouse: true, buyDate: '2012-06-01', cost: 5000000, improvements: [], saleDate: todayISO(), salePrice: 15000000, expenses: 200000, reinvest: { sec54: 0, sec54F: 0, sec54EC: 0 } },
  home_loan: { price: 8000000, loan: 6000000, ratePct: 8.5, tenureYears: 20, occupancy: 'self_occupied', expectedAnnualRent: 0, monthsInYear: 12 },
  salary_change: { ctc: 2400000, basicPct: 40, hraPctOfBasic: 50, employerNpsPctOfBasic: 0, bonus: 0, city: 'Bengaluru', rentPaid: 360000 },
  invest_deduction: { kind: 'healthParents', amount: 50000 },
  redeem_sgb: { units: 50, buyPrice: 4800, redemptionPrice: 9500, buyDate: '2018-10-01', redeemDate: todayISO(), route: 'secondary_market' },
  buyback: { symbol: '', shares: 100, buybackPrice: 2000, costPerShare: 1400, buyDate: '2024-03-01', date: todayISO(), promoter: false },
  switch_regime: { regime: 'old' },
};

function N({ label, v, set, hint, money = true, step }: { label: string; v: number; set: (n: number) => void; hint?: string; money?: boolean; step?: string }) {
  return <Field label={label} hint={hint}>{money ? <MoneyInput value={v} onChange={set} /> : <Input type="number" step={step ?? 'any'} value={v} onChange={(e) => set(Number(e.target.value))} />}</Field>;
}
function D({ label, v, set }: { label: string; v: string; set: (s: string) => void }) {
  return <Field label={label}><Input type="date" value={v} onChange={(e) => set(e.target.value)} /></Field>;
}

function InputsForm({ type, inputs, setInputs }: { type: ScenarioType; inputs: any; setInputs: (x: any) => void }) {
  const up = (k: string, v: unknown) => setInputs({ ...inputs, [k]: v });
  const g = 'grid gap-4 sm:grid-cols-2';
  switch (type) {
    case 'sell_equity':
      return (
        <div className="space-y-4">
          <div className={g}>
            <Field label="Symbol / fund"><Input value={inputs.symbol} onChange={(e) => up('symbol', e.target.value)} placeholder="INFY" /></Field>
            <Field label="Type"><Select value={inputs.assetType} onChange={(e) => up('assetType', e.target.value)}><option value="listed_equity">Listed shares</option><option value="equity_mf">Equity mutual fund</option></Select></Field>
            <N label="Units to sell" v={inputs.qty} set={(n) => up('qty', n)} money={false} />
            <N label="Expected price per unit" v={inputs.price} set={(n) => up('price', n)} money={false} />
            <D label="Sale date" v={inputs.date} set={(s) => up('date', s)} />
            <N label="Brokerage & charges" v={inputs.charges} set={(n) => up('charges', n)} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><span className="label-mono text-muted-fg">Your lots (sold FIFO, oldest first)</span><Button size="sm" variant="ghost" icon={<Plus className="size-3" />} onClick={() => up('lots', [...inputs.lots, { qty: 10, buyDate: todayISO(), buyPrice: 0 }])}>Lot</Button></div>
            {inputs.lots.map((l: any, i: number) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                <Input type="number" value={l.qty} onChange={(e) => up('lots', inputs.lots.map((x: any, j: number) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} placeholder="Qty" />
                <Input type="date" value={l.buyDate} onChange={(e) => up('lots', inputs.lots.map((x: any, j: number) => (j === i ? { ...x, buyDate: e.target.value } : x)))} />
                <Input type="number" value={l.buyPrice} onChange={(e) => up('lots', inputs.lots.map((x: any, j: number) => (j === i ? { ...x, buyPrice: Number(e.target.value) } : x)))} placeholder="Buy price" />
                <button className="px-2 text-muted-fg hover:text-danger" onClick={() => up('lots', inputs.lots.filter((_: any, j: number) => j !== i))} disabled={inputs.lots.length === 1}><Trash className="size-3.5" /></button>
              </div>
            ))}
          </div>
        </div>
      );
    case 'sell_property':
      return (
        <div className="space-y-4">
          <div className={g}>
            <Field label="Property"><Input value={inputs.label} onChange={(e) => up('label', e.target.value)} /></Field>
            <Field label="Type"><Select value={inputs.assetType} onChange={(e) => up('assetType', e.target.value)}><option value="property">Building / flat</option><option value="land">Land</option></Select></Field>
            <D label="Purchase date" v={inputs.buyDate} set={(s) => up('buyDate', s)} />
            <N label="Purchase cost" v={inputs.cost} set={(n) => up('cost', n)} />
            <D label="Sale date" v={inputs.saleDate} set={(s) => up('saleDate', s)} />
            <N label="Sale price" v={inputs.salePrice} set={(n) => up('salePrice', n)} />
            <N label="Transfer expenses (brokerage, legal)" v={inputs.expenses} set={(n) => up('expenses', n)} />
            <div className="self-end pb-2"><Switch checked={inputs.isResidentialHouse} onChange={(v) => up('isResidentialHouse', v)} label="Residential house" /></div>
          </div>
          <div className="label-mono text-muted-fg">Reinvestment (optional)</div>
          <div className="grid gap-4 sm:grid-cols-3">
            <N label="New house — Sec 54" v={inputs.reinvest.sec54} set={(n) => up('reinvest', { ...inputs.reinvest, sec54: n })} />
            <N label="54EC bonds (≤ Rs 50L)" v={inputs.reinvest.sec54EC} set={(n) => up('reinvest', { ...inputs.reinvest, sec54EC: n })} />
            <N label="House — Sec 54F" v={inputs.reinvest.sec54F} set={(n) => up('reinvest', { ...inputs.reinvest, sec54F: n })} hint="If selling land/other asset" />
          </div>
        </div>
      );
    case 'home_loan':
      return (
        <div className={g}>
          <N label="Property price" v={inputs.price} set={(n) => up('price', n)} />
          <N label="Loan amount" v={inputs.loan} set={(n) => up('loan', n)} />
          <N label="Interest rate (%)" v={inputs.ratePct} set={(n) => up('ratePct', n)} money={false} step="0.05" />
          <N label="Tenure (years)" v={inputs.tenureYears} set={(n) => up('tenureYears', n)} money={false} />
          <Field label="Use"><Select value={inputs.occupancy} onChange={(e) => up('occupancy', e.target.value)}><option value="self_occupied">Live in it</option><option value="let_out">Rent it out</option></Select></Field>
          {inputs.occupancy === 'let_out' && <N label="Expected annual rent" v={inputs.expectedAnnualRent} set={(n) => up('expectedAnnualRent', n)} />}
          <N label="EMI months in this Tax Year" v={inputs.monthsInYear} set={(n) => up('monthsInYear', n)} money={false} />
        </div>
      );
    case 'salary_change':
      return (
        <div className={g}>
          <N label="New CTC (annual)" v={inputs.ctc} set={(n) => up('ctc', n)} />
          <N label="Basic as % of CTC" v={inputs.basicPct} set={(n) => up('basicPct', n)} money={false} />
          <N label="HRA as % of basic" v={inputs.hraPctOfBasic} set={(n) => up('hraPctOfBasic', n)} money={false} />
          <N label="Employer NPS as % of basic (≤ 14)" v={inputs.employerNpsPctOfBasic} set={(n) => up('employerNpsPctOfBasic', n)} money={false} />
          <N label="Bonus" v={inputs.bonus} set={(n) => up('bonus', n)} />
          <Field label="City"><Select value={inputs.city} onChange={(e) => up('city', e.target.value)}>{CITY_OPTIONS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <N label="Annual rent" v={inputs.rentPaid} set={(n) => up('rentPaid', n)} />
        </div>
      );
    case 'invest_deduction':
      return (
        <div className={g}>
          <Field label="What"><Select value={inputs.kind} onChange={(e) => up('kind', e.target.value)}>
            <option value="healthParents">Health insurance for parents (80D)</option><option value="healthSelf">Health insurance for self/family (80D)</option><option value="sec80CCD1B">NPS — own contribution (80CCD(1B))</option><option value="sec80C">ELSS / PPF / 80C</option><option value="employerNps">Employer NPS (restructure salary)</option><option value="sec80E">Education-loan interest</option>
          </Select></Field>
          <N label="Amount" v={inputs.amount} set={(n) => up('amount', n)} />
        </div>
      );
    case 'redeem_sgb':
      return (
        <div className={g}>
          <N label="Units (grams)" v={inputs.units} set={(n) => up('units', n)} money={false} />
          <Field label="How you bought / exit"><Select value={inputs.route} onChange={(e) => up('route', e.target.value)}><option value="original_issue_held_to_maturity">Original RBI issue, redeemed at maturity</option><option value="secondary_market">Bought on exchange, redeemed with RBI</option><option value="exchange_sale">Selling on the exchange</option></Select></Field>
          <N label="Buy price per unit" v={inputs.buyPrice} set={(n) => up('buyPrice', n)} money={false} />
          <N label="Redemption price per unit" v={inputs.redemptionPrice} set={(n) => up('redemptionPrice', n)} money={false} />
          <D label="Bought on" v={inputs.buyDate} set={(s) => up('buyDate', s)} />
          <D label="Redeemed on" v={inputs.redeemDate} set={(s) => up('redeemDate', s)} />
        </div>
      );
    case 'buyback':
      return (
        <div className={g}>
          <Field label="Company"><Input value={inputs.symbol} onChange={(e) => up('symbol', e.target.value)} /></Field>
          <N label="Shares tendered" v={inputs.shares} set={(n) => up('shares', n)} money={false} />
          <N label="Buyback price" v={inputs.buybackPrice} set={(n) => up('buybackPrice', n)} money={false} />
          <N label="Your cost per share" v={inputs.costPerShare} set={(n) => up('costPerShare', n)} money={false} />
          <D label="Bought on" v={inputs.buyDate} set={(s) => up('buyDate', s)} />
          <D label="Buyback date" v={inputs.date} set={(s) => up('date', s)} />
          <div className="sm:col-span-2"><Switch checked={inputs.promoter} onChange={(v) => up('promoter', v)} label="I am a promoter" /></div>
        </div>
      );
    case 'switch_regime':
      return <Field label="Regime"><Select value={inputs.regime} onChange={(e) => up('regime', e.target.value)}><option value="old">Old regime</option><option value="new">New regime</option></Select></Field>;
  }
}

function ResultPanel({ r, actions }: { r: Result; actions?: ReactNode }) {
  const up = r.delta > 0;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="overflow-hidden">
        <div className="grid gap-px bg-line sm:grid-cols-3">
          <div className="bg-card p-5"><div className="label-mono text-muted-fg">Before ({r.regime})</div><div className="mt-2 text-2xl font-light tabular">{inr(r.before.chosen)}</div></div>
          <div className="bg-card p-5"><div className="label-mono text-muted-fg">After</div><div className="mt-2 text-2xl font-light"><AnimatedNumber value={r.after.chosen} format={(n) => inr(n)} /></div></div>
          <div className={cn('p-5', up ? 'bg-c2/10' : r.delta < 0 ? 'bg-lime-soft' : 'bg-card')}>
            <div className="label-mono text-muted-fg">Difference</div>
            <div className={cn('mt-2 flex items-center gap-1 text-2xl font-light tabular', up ? 'text-c2' : r.delta < 0 ? 'text-lime' : '')}>{up ? <ArrowUpRight className="size-5" /> : r.delta < 0 ? <ArrowDownRight className="size-5" /> : null}{inr(r.delta, { sign: true })}</div>
          </div>
        </div>
        <div className="grid gap-4 border-t border-line p-5 md:grid-cols-2">
          <div>
            <div className="label-mono mb-2 text-muted-fg">Both regimes</div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-fg"><th className="font-normal" /><th className="font-normal">Before</th><th className="font-normal">After</th></tr></thead>
              <tbody>
                {(['new', 'old'] as const).map((k) => <tr key={k} className="border-t border-line"><td className="py-1.5 capitalize text-muted-fg">{k}</td><td className="tabular">{inr(r.before[k])}</td><td className="tabular">{inr(r.after[k])}{r.bestRegimeAfter === k && <span className="ml-1.5 font-mono text-[0.58rem] text-lime">BEST</span>}</td></tr>)}
              </tbody>
            </table>
          </div>
          <div>
            <div className="label-mono mb-2 text-muted-fg">Rules that caused it</div>
            <div className="flex flex-wrap gap-1.5">{r.ruleIds.map((id) => <RuleChip key={id} ruleId={id} />)}</div>
          </div>
        </div>
        {r.insights.length > 0 && (
          <div className="space-y-2 border-t border-line p-5">
            {r.insights.map((i, k) => (
              <div key={k} className={cn('flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm', i.kind === 'saving' ? 'border-lime/30 bg-lime-soft' : i.kind === 'warning' ? 'border-c2/30 bg-c2/10' : 'border-line bg-card-2')}>
                <span className="flex-1">{i.text}</span>{i.ruleId && <RuleChip ruleId={i.ruleId} />}
              </div>
            ))}
          </div>
        )}
        {r.deadlines.length > 0 && (
          <div className="border-t border-line p-5">
            <div className="label-mono mb-2 text-muted-fg">Deadlines this creates</div>
            <div className="grid gap-2 sm:grid-cols-2">{r.deadlines.map((d) => <div key={d.type} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm"><CalendarClock className="size-3.5 text-c2" /><span className="flex-1">{d.title}</span><span className="tabular text-muted-fg">{fmtDate(d.dueDate)}</span></div>)}</div>
          </div>
        )}
        {actions && <div className="flex flex-wrap gap-2 border-t border-line p-4">{actions}</div>}
      </Card>
    </motion.div>
  );
}

export default function Scenarios() {
  const ty = useTY();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const inv = useInvalidateProfile();
  const saved = useScenarios();
  const [type, setType] = useState<ScenarioType>('sell_equity');
  const [inputs, setInputs] = useState<any>(DEFAULTS.sell_equity);
  const [name, setName] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);

  useEffect(() => {
    const t = sp.get('type') as ScenarioType | null;
    if (t && DEFAULTS[t]) {
      setType(t);
      try { setInputs({ ...DEFAULTS[t], ...JSON.parse(sp.get('inputs') ?? '{}') }); } catch { setInputs(DEFAULTS[t]); }
      setResult(null);
      setSp({}, { replace: true });
    }
  }, [sp, setSp]);

  const run = useMutation({
    mutationFn: (v: { save: boolean; inputs?: any; name?: string }) => api<{ result: Result; scenario?: { id: string } }>('/scenarios', { body: { taxYear: ty, type, inputs: v.inputs ?? inputs, save: v.save, name: (v.name ?? name) || undefined } }),
    onSuccess: (r, { save }) => { setResult(r.result); if (save && r.scenario) { setSavedId(r.scenario.id); qc.invalidateQueries({ queryKey: ['scenarios'] }); toast('Scenario saved'); } else setSavedId(null); },
  });
  const apply = useMutation({
    mutationFn: (id: string) => api(`/scenarios/${id}/apply`, { method: 'POST' }),
    onSuccess: async () => { await inv(); qc.invalidateQueries({ queryKey: ['scenarios'] }); toast('Applied to your profile — deadlines added to the planner'); },
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/scenarios/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['scenarios'] }) });

  const wait = result?.details?.wait as { until: string; days: number; saving: number } | undefined;
  const compareRows = useMemo(() => saved.data?.scenarios.filter((s) => compare.includes(s.id)) ?? [], [saved.data, compare]);

  return (
    <div>
      <PageHeader label="F5 · What-if simulator" title={<>See the tax <span className="text-lime">before</span> you act</>} description="Each scenario applies one change to your current profile and shows before/after tax, the difference, and the rules behind it. Your saved profile never changes until you choose Apply." />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(SCENARIO_LABELS) as ScenarioType[]).map((t) => (
          <button key={t} onClick={() => { setType(t); setInputs(DEFAULTS[t]); setResult(null); setSavedId(null); }} className={cn('flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition', type === t ? 'border-lime/60 bg-lime-soft' : 'border-line bg-card hover:border-line-strong')}>
            <span className={cn('grid size-8 shrink-0 place-items-center rounded-md border [&_svg]:size-4', type === t ? 'border-lime/40 text-lime' : 'border-line text-muted-fg')}>{ICONS[t]}</span>
            {SCENARIO_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,440px)_1fr]">
        <Card className="h-fit">
          <CardHeader label="Inputs" title={SCENARIO_LABELS[type]} />
          <div className="space-y-4 p-5">
            <InputsForm type={type} inputs={inputs} setInputs={setInputs} />
            <Field label="Name (for saving)"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={SCENARIO_LABELS[type]} /></Field>
            <ErrorNote error={run.error} />
            <div className="flex gap-2">
              <Button className="flex-1" icon={<Play className="size-3.5" />} loading={run.isPending && !run.variables?.save} onClick={() => run.mutate({ save: false })}>Run</Button>
              <Button variant="secondary" icon={<Save className="size-3.5" />} loading={run.isPending && run.variables?.save} onClick={() => run.mutate({ save: true })}>Save</Button>
            </div>
          </div>
        </Card>
        <div>
          <AnimatePresence mode="wait">
            {result ? (
              <ResultPanel key={JSON.stringify(result.after)} r={result} actions={<>
                {wait && wait.saving > 0 && <Button variant="outline-lime" icon={<GitCompare className="size-3.5" />} onClick={() => { const next = { ...inputs, date: wait.until }; const n = `Sell after ${wait.days} days`; setInputs(next); setName(n); run.mutate({ save: true, inputs: next, name: n }); }}>Save “sell after {wait.days} days” to compare</Button>}
                {savedId ? <Button icon={<Check className="size-3.5" />} loading={apply.isPending} onClick={() => apply.mutate(savedId)}>Apply to profile</Button> : <Button variant="secondary" icon={<Save className="size-3.5" />} onClick={() => run.mutate({ save: true })}>Save to apply later</Button>}
              </>} />
            ) : (
              <Card><EmptyState icon={<Play className="size-5" />} title="Run a scenario" body="Fill in the inputs and press Run. Nothing is saved to your profile." /></Card>
            )}
          </AnimatePresence>
          <ErrorNote error={apply.error} />
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader label="Saved scenarios" title="Compare side by side" action={compare.length > 0 && <Button size="sm" variant="ghost" onClick={() => setCompare([])}>Clear</Button>} />
        {saved.data?.scenarios.length ? (
          <div className="divide-y divide-line">
            {saved.data.scenarios.map((s: SavedScenario) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <input type="checkbox" className="accent-[var(--primary)]" checked={compare.includes(s.id)} onChange={(e) => setCompare((c) => (e.target.checked ? [...c, s.id].slice(-3) : c.filter((x) => x !== s.id)))} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <Chip tone="muted">{SCENARIO_LABELS[s.type]}</Chip>
                <span className={cn('w-28 text-right tabular', s.result.delta > 0 ? 'text-c2' : s.result.delta < 0 ? 'text-lime' : '')}>{inr(s.result.delta, { sign: true })}</span>
                {s.appliedAt ? <Chip tone="lime">Applied</Chip> : <Button size="sm" variant="secondary" onClick={() => apply.mutate(s.id)}>Apply</Button>}
                <button className="p-1 text-muted-fg hover:text-danger" onClick={() => del.mutate(s.id)} aria-label="Delete"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
        ) : <div className="px-5 py-6 text-sm text-muted-fg">Saved scenarios appear here. Tick up to three to compare.</div>}
        {compareRows.length > 1 && (
          <div className="overflow-x-auto border-t border-line p-5">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="text-left text-xs text-muted-fg"><th className="pb-2 font-normal">Metric</th>{compareRows.map((s) => <th key={s.id} className="pb-2 font-normal">{s.name}</th>)}</tr></thead>
              <tbody className="tabular">
                {[
                  ['Tax before', (s: SavedScenario) => inr(s.result.before.chosen)],
                  ['Tax after', (s: SavedScenario) => inr(s.result.after.chosen)],
                  ['Difference', (s: SavedScenario) => inr(s.result.delta, { sign: true })],
                  ['New regime after', (s: SavedScenario) => inr(s.result.after.new)],
                  ['Old regime after', (s: SavedScenario) => inr(s.result.after.old)],
                  ['Best regime', (s: SavedScenario) => s.result.bestRegimeAfter],
                ].map(([label, f]) => (
                  <tr key={label as string} className="border-t border-line"><td className="py-2 text-muted-fg">{label as string}</td>{compareRows.map((s) => <td key={s.id} className="py-2">{(f as (s: SavedScenario) => string)(s)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 flex items-center gap-1 text-xs text-muted-fg"><ArrowRight className="size-3" />Apply checks that your profile hasn't changed since the scenario was saved, so old scenarios stay reproducible.</p>
    </div>
  );
}
