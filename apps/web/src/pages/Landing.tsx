import { compareRegimes } from '@fiscai/tax-engine';
import { motion } from 'motion/react';
import { ArrowRight, ArrowUpRight, BookOpen, Calculator, Calendar, CandlestickChart, FileText, FlaskConical, HandCoins, MessageSquare, Scale, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Disclaimer } from '../components/Disclaimer';
import { Logo } from '../components/layout/Logo';
import { AnimatedNumber, Button, Card, Chip, cn, MoneyInput, Tabs } from '../components/ui';
import { inr } from '../lib/format';

const FEATURES = [
  { icon: <FileText />, title: 'Smart document ingestion', body: 'Form 16, AIS, broker P&L, CAS and salary slips. Every value traced to its page or row.' },
  { icon: <Scale />, title: 'Regime optimiser', body: 'Old vs new side by side, the break-even deduction, and the levers that flip the answer.' },
  { icon: <FlaskConical />, title: 'What-if simulator', body: 'Sell shares, sell a flat, take a home loan, switch jobs. See the tax before you act.' },
  { icon: <MessageSquare />, title: 'Explainable assistant', body: 'Plain-language answers that call the engine for every number and cite the rule.' },
  { icon: <Calendar />, title: 'Advance tax & deadlines', body: '15/45/75/100% instalments, 234B/C interest, 54EC windows and ITR dates, with reminders.' },
  { icon: <HandCoins />, title: 'Deduction finder', body: 'Unused headroom in rupees, and schemes that actually help in your regime.' },
  { icon: <CandlestickChart />, title: 'Traders & crypto', body: 'F&O turnover, audit check, Budget 2026 STT impact, and flat-30% VDA tracking.' },
  { icon: <Users />, title: 'Household view', body: 'Spouse and parents: health-insurance planning and clubbing warnings on gifts.' },
];

const STEPS = [
  { k: '01', t: 'Answer five questions', d: 'Age, city, job type, rent and income sources.' },
  { k: '02', t: 'Upload what you have', d: 'Form 16 or a broker statement. Review low-confidence fields beside the source page.' },
  { k: '03', t: 'See where your tax goes', d: 'Both regimes compared, every line expandable into its maths and section.' },
];

function HeroCalculator() {
  const [salary, setSalary] = useState(1800000);
  const [ded, setDed] = useState(150000);
  const [view, setView] = useState<'new' | 'old'>('new');
  const c = useMemo(() => compareRegimes({ taxYear: '2026-27', personal: { city: 'Other' }, salary: { basic: salary }, deductions: { sec80C: ded } }), [salary, ded]);
  const r = c[view];
  return (
    <Card className="glow-lime relative overflow-hidden p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <Chip tone="lime"><Calculator className="size-3" /> Live engine · in your browser</Chip>
        <span className="font-mono text-[0.6rem] text-muted-fg">TY 2026-27</span>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="mb-1.5 block text-xs text-muted-fg">Annual salary</span><MoneyInput value={salary} onChange={setSalary} /></label>
        <label className="block"><span className="mb-1.5 block text-xs text-muted-fg">80C investments</span><MoneyInput value={ded} onChange={setDed} /></label>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {(['new', 'old'] as const).map((k) => (
          <div key={k} className={cn('rounded-lg border p-4 transition-colors', c.recommended === k ? 'border-lime/50 bg-lime-soft' : 'border-line bg-card-2')}>
            <div className="flex items-center justify-between"><span className="label-mono text-muted-fg">{k} regime</span>{c.recommended === k && <span className="font-mono text-[0.58rem] text-lime">BEST</span>}</div>
            <div className="mt-2 text-2xl font-light tracking-tight"><AnimatedNumber value={c[k].totalTax} format={(n) => inr(n)} /></div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between">
        <Tabs value={view} onChange={setView} options={[{ value: 'new', label: 'New' }, { value: 'old', label: 'Old' }]} />
        <span className="text-xs text-muted-fg">Why? ↓</span>
      </div>
      <div className="mt-3 max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-line bg-card-2 p-3 font-mono text-[0.68rem]">
        {r.trace.filter((t) => t.output !== 0 || t.key === 'totalTax').slice(0, 12).map((t) => (
          <div key={t.step} className="flex justify-between gap-3">
            <span className="truncate text-muted-fg">{String(t.step).padStart(2, '0')} {t.label}{t.ruleId && <span className="text-lime"> [{t.ruleId}]</span>}</span>
            <span className="tabular text-fg">{inr(t.output)}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[0.7rem] text-muted-fg">Salary only, below 60, resident. Sign up to include HRA, capital gains, F&O and more.</p>
    </Card>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <div className="overflow-hidden whitespace-nowrap bg-lime py-1.5 text-black">
        <motion.div className="inline-flex gap-12 font-mono text-[0.68rem] uppercase tracking-[0.14em]" animate={{ x: ['0%', '-50%'] }} transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}>
          {Array.from({ length: 2 }).flatMap((_, j) => [
            'Income-tax Act, 2025 ready', 'Rs 12 lakh rebate + marginal relief', '8 HRA metros from TY 2026-27', 'STT hike on F&O modelled', 'SGB & buyback rules updated', 'Rs 1.25 lakh LTCG harvesting',
          ].map((t, i) => <span key={`${j}-${i}`}>✦ {t}</span>))}
        </motion.div>
      </div>

      <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-2">
            <Link to="/login" className="hidden px-3 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted-fg hover:text-fg sm:block">Log in</Link>
            <Link to="/register"><Button size="sm">Get started</Button></Link>
          </div>
        </div>
      </header>

      <section className="grid-bg relative">
        <div className="pointer-events-none absolute left-1/2 top-24 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-lime/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-24">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
            <Chip tone="lime">Personal tax co-pilot — for salaried & investing Indians</Chip>
            <h1 className="mt-6 text-[2.6rem] font-normal leading-[1.05] tracking-tight sm:text-6xl">
              Know your tax<br />before you <span className="text-lime">decide</span>.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-fg sm:text-lg">
              FiscAI reads your documents, tells you what you owe and why, and shows the tax impact of a money decision before you make it. Every number comes from a tested rules engine, never from a guess.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register"><Button size="lg" icon={<ArrowUpRight className="size-4" />}>Start free</Button></Link>
              <a href="#how"><Button size="lg" variant="secondary">How it works</Button></a>
            </div>
            <div className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-line pt-6">
              {[['16', 'features'], ['100%', 'engine-computed'], ['2', 'Acts supported']].map(([a, b]) => (
                <div key={b}><div className="text-2xl font-light">{a}</div><div className="label-mono mt-1 text-muted-fg">{b}</div></div>
              ))}
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}>
            <HeroCalculator />
          </motion.div>
        </div>
      </section>

      <section id="how" className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="label-mono text-lime">How it works</div>
          <h2 className="mt-3 max-w-2xl text-3xl font-normal tracking-tight sm:text-4xl">From signup to your first tax number in under five minutes.</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <motion.div key={s.k} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}>
                <Card hover className="h-full p-6">
                  <div className="font-mono text-sm text-lime">{s.k}</div>
                  <div className="mt-4 text-lg">{s.t}</div>
                  <p className="mt-2 text-sm text-muted-fg">{s.d}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="label-mono text-lime">Year-round planning</div>
              <h2 className="mt-3 text-3xl font-normal tracking-tight sm:text-4xl">Not a filing tool. A decision aid.</h2>
            </div>
            <Link to="/register" className="inline-flex items-center gap-1 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted-fg hover:text-lime">Browse all features <ArrowRight className="size-3.5" /></Link>
          </div>
          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => (
              <motion.div key={f.title} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.04 }} className="group bg-bg p-6 transition-colors hover:bg-card">
                <div className="grid size-9 place-items-center rounded-md border border-line text-lime transition group-hover:border-lime/40 [&_svg]:size-4">{f.icon}</div>
                <div className="mt-4 font-medium">{f.title}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-fg">{f.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <div className="label-mono text-lime">Trust, by design</div>
            <h2 className="mt-3 text-3xl font-normal tracking-tight sm:text-4xl">The AI explains. The engine computes.</h2>
            <p className="mt-4 text-muted-fg">Slabs, limits and rates live in versioned rule packs for each Tax Year and Act. The engine is a pure function that returns the result and a trace of every step. The assistant can only quote numbers it gets from the engine, and every answer cites a rule card with both its 1961-Act and 2025-Act section.</p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                [<ShieldCheck key="a" />, 'PAN, Aadhaar and account numbers redacted before any text reaches the model'],
                [<Sparkles key="b" />, 'Low-confidence extractions highlighted, never silently accepted'],
                [<BookOpen key="c" />, 'Sensitive fields encrypted at rest; delete everything in one click'],
              ].map(([i, t], k) => <li key={k} className="flex items-start gap-3 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:text-lime">{i}<span className="text-fg/85">{t}</span></li>)}
            </ul>
          </div>
          <Card className="p-0">
            <div className="border-b border-line px-5 py-3 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted-fg">trace · computeTax(profile, IN-TY2026-27-NEW)</div>
            <pre className="overflow-x-auto p-5 font-mono text-[0.72rem] leading-relaxed text-muted-fg">{`{
  "step": 14,
  "key": "marginalRelief",
  "label": "Marginal relief on rebate",
  "ruleId": "REBATE-87A",
  "input": { "incomeAboveLimit": 25000 },
  "output": -38750
}`}</pre>
            <div className="border-t border-line px-5 py-3 text-xs text-muted-fg">Rule <span className="text-lime">REBATE-87A</span> · 1961 Act §87A · 2025 Act § TBC (pending mapping)</div>
          </Card>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
          <h2 className="mx-auto max-w-2xl text-3xl font-normal tracking-tight sm:text-5xl">Every money decision, <span className="text-lime">with its tax</span>.</h2>
          <div className="mt-8"><Link to="/register"><Button size="lg" icon={<ArrowUpRight className="size-4" />}>Create your account</Button></Link></div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
          <div className="flex items-center justify-between"><Logo /><span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted-fg">MERN · v2</span></div>
          <Disclaimer />
        </div>
      </footer>
    </div>
  );
}
