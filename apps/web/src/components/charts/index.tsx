import type { SlabBand, TaxResult } from '@fiscai/tax-engine';
import { motion } from 'motion/react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { inr, pct } from '../../lib/format';
import { cn } from '../ui';

const tooltipStyle = { background: 'var(--card)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 12, color: 'var(--foreground)' };

/** Waterfall from gross income to net tax. */
export function Waterfall({ r }: { r: TaxResult }) {
  const gross = r.income.salary.gross + Math.max(0, r.income.houseProperty.total) + r.income.otherSources.total + Math.max(0, r.income.business.total)
    + r.income.capitalGains.txns.reduce((s, t) => s + Math.max(0, t.gain), 0) + r.income.vda.gains;
  const exemptions = Math.max(0, gross - r.grossTotalIncome);
  const steps: { name: string; value: number; kind: 'total' | 'minus' | 'plus' }[] = [
    { name: 'Gross', value: gross, kind: 'total' },
    { name: 'Exemptions', value: -exemptions, kind: 'minus' },
    { name: 'Deductions', value: -r.deductions.total, kind: 'minus' },
    { name: 'Taxable', value: r.totalIncome, kind: 'total' },
  ];
  let running = 0;
  const data = steps.map((s) => {
    if (s.kind === 'total') { running = s.value; return { name: s.name, base: 0, bar: s.value, kind: s.kind, label: s.value }; }
    const start = running;
    running += s.value;
    return { name: s.name, base: Math.min(start, running), bar: Math.abs(s.value), kind: s.kind, label: s.value };
  });
  const taxData = [
    { name: 'Slab tax', value: r.slabTax },
    { name: 'Special-rate', value: r.specialTax.total },
    { name: 'Rebate/relief', value: -(r.rebate + r.marginalRelief) },
    { name: 'Surcharge', value: r.surcharge },
    { name: 'Cess', value: r.cess },
  ].filter((d) => d.value !== 0);
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} interval={0} />
            <YAxis hide />
            <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.4 }} contentStyle={tooltipStyle} itemStyle={{ color: 'var(--foreground)' }} labelStyle={{ color: 'var(--muted-foreground)', marginBottom: 2 }} formatter={(_v, _n, p: any) => [inr(p.payload.label), p.payload.name]} />
            <Bar dataKey="base" stackId="a" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="bar" stackId="a" radius={[3, 3, 0, 0]} animationDuration={900}>
              {data.map((d, i) => <Cell key={i} fill={d.kind === 'total' ? (i === 0 ? 'var(--border-strong)' : 'var(--primary)') : 'var(--chart-1)'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div>
        <div className="label-mono mb-3 text-muted-fg">Taxable income → tax</div>
        <div className="space-y-2.5">
          {taxData.map((d, i) => (
            <div key={d.name} className="flex items-center gap-3 text-sm">
              <span className="w-28 shrink-0 text-muted-fg">{d.name}</span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: d.value < 0 ? 'var(--primary)' : `var(--chart-${(i % 5) + 1})` }} initial={{ width: 0 }} animate={{ width: `${Math.min(100, (Math.abs(d.value) / Math.max(1, r.slabTax + r.specialTax.total)) * 100)}%` }} transition={{ duration: 0.8, delay: i * 0.06 }} />
              </div>
              <span className={cn('w-24 text-right tabular', d.value < 0 && 'text-lime')}>{inr(d.value)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-line pt-2.5 text-sm font-medium">
            <span>Total tax</span><span className="tabular">{inr(r.totalTax)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** How much normal income falls in each slab. */
export function SlabBar({ slabs, normalIncome }: { slabs: SlabBand[]; normalIncome: number }) {
  const used = slabs.filter((s) => s.income > 0);
  if (!used.length) return <div className="text-sm text-muted-fg">No income in taxable slabs.</div>;
  const colors = ['var(--border-strong)', 'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', '#7a2200'];
  return (
    <div>
      <div className="flex h-9 w-full overflow-hidden rounded-md border border-line">
        {used.map((s, i) => (
          <motion.div key={i} title={`${pct(s.rate, 0)}: ${inr(s.income)}`} className="relative flex items-center justify-center overflow-hidden border-r border-black/20 last:border-r-0" style={{ background: s.rate === 0 ? 'var(--primary-soft)' : colors[Math.min(colors.length - 1, Math.round(s.rate * 20))] }} initial={{ width: 0 }} animate={{ width: `${(s.income / normalIncome) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}>
            <span className={cn('font-mono text-[0.62rem]', s.rate === 0 ? 'text-lime' : 'text-black/80')}>{pct(s.rate, 0)}</span>
          </motion.div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        {used.map((s, i) => (
          <div key={i} className="flex justify-between gap-2">
            <span className="whitespace-nowrap text-muted-fg">{inr(s.from, { compact: true })} – {s.to ? inr(s.to, { compact: true }) : 'above'} @ {pct(s.rate, 0)}</span>
            <span className="tabular">{inr(s.tax)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RateMeter({ effective, marginal }: { effective: number; marginal: number }) {
  const max = Math.max(0.42, marginal + 0.05);
  return (
    <div className="space-y-4">
      {[{ label: 'Effective rate', v: effective, color: 'var(--primary)', note: 'Total tax ÷ gross income' }, { label: 'Marginal rate', v: marginal, color: 'var(--chart-2)', note: 'Tax on your next ₹100 (incl. cess)' }].map((x) => (
        <div key={x.label}>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-fg">{x.label}</span>
            <span className="text-xl font-light tabular">{pct(x.v)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div className="h-full rounded-full" style={{ background: x.color }} initial={{ width: 0 }} animate={{ width: `${(x.v / max) * 100}%` }} transition={{ duration: 0.9 }} />
          </div>
          <div className="mt-1 text-[0.7rem] text-muted-fg">{x.note}</div>
        </div>
      ))}
    </div>
  );
}

export function CompareBars({ items }: { items: { label: string; value: number; highlight?: boolean }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-3">
      {items.map((i) => (
        <div key={i.label}>
          <div className="mb-1 flex justify-between text-sm"><span className={i.highlight ? 'text-fg' : 'text-muted-fg'}>{i.label}</span><span className="tabular">{inr(i.value)}</span></div>
          <div className="h-2.5 overflow-hidden rounded-sm bg-muted">
            <motion.div className="h-full" style={{ background: i.highlight ? 'var(--primary)' : 'var(--chart-2)' }} initial={{ width: 0 }} animate={{ width: `${(i.value / max) * 100}%` }} transition={{ duration: 0.8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
