import { motion } from 'motion/react';
import { AlertTriangle, ArrowUpRight, CalendarClock, FileUp, FlaskConical, MessageSquare, Scale } from 'lucide-react';
import { Link } from 'react-router-dom';
import { RateMeter, SlabBar, Waterfall } from '../components/charts';
import { RuleChip } from '../components/RuleChip';
import { AnimatedNumber, Button, Card, CardHeader, Chip, EmptyState, ErrorNote, PageHeader, Skeleton } from '../components/ui';
import { WhyLine } from '../components/WhyLine';
import { useApp } from '../lib/context';
import { daysUntil, fmtDate, inr } from '../lib/format';
import { useSummary } from '../lib/queries';

export default function Dashboard() {
  const { taxYear, user } = useApp();
  const { data, isLoading, error } = useSummary();

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div><Skeleton className="h-72" /></div>;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;

  if (data.profileVersion === 0) {
    return (
      <Card>
        <EmptyState icon={<FileUp className="size-5" />} title={`No profile for Tax Year ${taxYear} yet`} body="Upload a Form 16 or fill in your tax profile to see where your tax goes." action={<div className="flex gap-2"><Link to="/documents"><Button>Upload a document</Button></Link><Link to="/profile"><Button variant="secondary">Enter manually</Button></Link></div>} />
      </Card>
    );
  }

  const r = data.result;
  const due = r.balance;
  const other = data.regime === 'new' ? 'old' : 'new';
  const better = data.comparison.recommended !== data.regime;

  return (
    <div>
      <PageHeader
        label={`Tax Year ${taxYear} · ${r.act === 'ITA-2025' ? 'Income-tax Act, 2025' : 'Income-tax Act, 1961'}`}
        title={<>Where your tax <span className="text-lime">goes</span></>}
        description={`Hi ${user?.name?.split(' ')[0] || 'there'} — computed by the rules engine (${r.packId}). Tap any line for the maths and the section.`}
        actions={<><Link to="/scenarios"><Button variant="secondary" icon={<FlaskConical className="size-3.5" />}>What if…</Button></Link><Link to="/assistant"><Button icon={<MessageSquare className="size-3.5" />}>Ask</Button></Link></>}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr]">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="relative h-full overflow-hidden p-6">
            <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-lime/10 blur-3xl" />
            <div className="label-mono text-muted-fg">{r.prepaid.total === 0 ? 'Your tax for the year' : due >= 0 ? 'Balance tax payable' : 'Refund due'}</div>
            <div className={`mt-2 text-[2.6rem] font-light leading-none tracking-tight ${due > 0 ? 'text-c2' : 'text-lime'}`}>
              <AnimatedNumber value={Math.abs(due)} format={(n) => inr(n)} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm">
              <div><div className="text-muted-fg">Total tax</div><div className="mt-0.5 tabular">{inr(r.totalTax)}</div></div>
              <div><div className="text-muted-fg">Already paid (TDS/advance)</div><div className="mt-0.5 tabular">{r.prepaid.total ? inr(r.prepaid.total) : <Link to="/profile" className="text-lime hover:underline">Add if any</Link>}</div></div>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card className="flex h-full flex-col p-6">
            <div className="flex items-center justify-between"><div className="label-mono text-muted-fg">Regime</div><Chip tone={better ? 'orange' : 'lime'}>{data.regime} regime</Chip></div>
            <div className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-3"><span className="text-muted-fg">New regime</span><span className="tabular">{inr(data.comparison.new)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-fg">Old regime</span><span className="tabular">{inr(data.comparison.old)}</span></div>
            </div>
            <div className="mt-auto pt-4">
              {better ? (
                <Link to="/regime" className="flex items-center justify-between rounded-md border border-c2/30 bg-c2/10 px-3 py-2 text-xs text-c2">Switching to {other} saves {inr(data.comparison.savings)}<ArrowUpRight className="size-3.5" /></Link>
              ) : (
                <Link to="/regime" className="flex items-center justify-between rounded-md border border-lime/30 bg-lime-soft px-3 py-2 text-xs text-lime">You're on the cheaper regime{data.comparison.savings ? ` (saves ${inr(data.comparison.savings)})` : ''}<Scale className="size-3.5" /></Link>
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="flex h-full flex-col p-6">
            <div className="flex items-center justify-between"><div className="label-mono text-muted-fg">Next deadline</div><CalendarClock className="size-4 text-muted-fg" /></div>
            {data.nextDeadline ? (
              <>
                <div className="mt-3 text-[0.95rem] leading-snug">{data.nextDeadline.title}</div>
                <div className="mt-2 flex items-baseline gap-2"><span className="text-2xl font-light">{daysUntil(data.nextDeadline.dueDate)}</span><span className="text-sm text-muted-fg">days · {fmtDate(data.nextDeadline.dueDate)}</span></div>
                {!!data.nextDeadline.amount && <div className="mt-1 text-sm text-c2">{inr(data.nextDeadline.amount)} due</div>}
                {(data.nextDeadline as any).type === 'advance_tax' && r.prepaid.tds === 0 && r.income.salary.gross > 0 && (
                  <p className="mt-2 text-xs text-muted-fg">Salaried? Your employer usually cuts tax every month (TDS). <Link to="/profile" className="text-lime hover:underline">Add it</Link> and this may drop to zero.</p>
                )}
                <Link to="/planner" className="mt-auto pt-4 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-lime hover:underline">Open planner →</Link>
              </>
            ) : <div className="mt-3 text-sm text-muted-fg">Nothing due. We'll remind you 30, 7 and 1 day before each deadline.</div>}
          </Card>
        </motion.div>
      </div>

      {r.warnings.length > 0 && (
        <div className="mt-4 space-y-2">
          {r.warnings.map((w) => <div key={w} className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn"><AlertTriangle className="mt-px size-3.5 shrink-0" />{w}</div>)}
        </div>
      )}

      <Card className="mt-4">
        <CardHeader label="Waterfall" title="From gross income to net tax" />
        <div className="p-5"><Waterfall r={r} /></div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader label="Slabs" title={`How your ${inr(r.normalIncome)} of normal income is taxed`} action={<RuleChip ruleId={r.regime === 'new' ? 'REGIME-NEW' : 'REGIME-OLD'} />} />
          <div className="p-5">
            <SlabBar slabs={r.slabs} normalIncome={Math.max(1, r.normalIncome)} />
            {r.specialIncome > 0 && <p className="mt-4 text-xs text-muted-fg">Plus {inr(r.specialIncome)} of special-rate income (capital gains / VDA) taxed separately at {inr(r.specialTax.total)}.</p>}
          </div>
        </Card>
        <Card>
          <CardHeader label="Rates" title="Effective vs marginal" />
          <div className="p-5"><RateMeter effective={r.effectiveRate} marginal={r.marginalRate} /></div>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader label="Computation" title="Every line, with its why" action={<Link to="/profile"><Button variant="ghost" size="sm">Edit profile</Button></Link>} />
        <div>{r.lines.map((l) => <WhyLine key={l.key} line={l} />)}</div>
      </Card>

      {(user?.metrics?.scenariosRun || user?.metrics?.taxSavedEstimate) ? (
        <div className="mt-4 flex flex-wrap gap-6 rounded-md border border-line px-5 py-3 text-xs text-muted-fg">
          <span>Scenarios run: <span className="text-fg">{user?.metrics?.scenariosRun ?? 0}</span></span>
          <span>Estimated tax saved from applied actions: <span className="text-lime">{inr(user?.metrics?.taxSavedEstimate ?? 0)}</span></span>
        </div>
      ) : null}
    </div>
  );
}
