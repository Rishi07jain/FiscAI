import { Download, FileJson } from 'lucide-react';
import { RuleChip } from '../components/RuleChip';
import { Button, Card, CardHeader, Chip, ErrorNote, PageHeader, Skeleton } from '../components/ui';
import { inr } from '../lib/format';
import { useItr, useTY } from '../lib/queries';

function Rows({ rows }: { rows: [string, number | string][] }) {
  return <div className="divide-y divide-line">{rows.map(([k, v]) => <div key={k} className="flex justify-between px-5 py-2 text-sm"><span className="text-muted-fg">{k}</span><span className="tabular">{typeof v === 'number' ? inr(v) : v}</span></div>)}</div>;
}

export default function Itr() {
  const ty = useTY();
  const { data: p, isLoading, error } = useItr();
  if (isLoading || !p) return <Skeleton className="h-96" />;
  if (error) return <ErrorNote error={error} />;
  const s = p.schedules;
  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fiscai-itr-pack-${ty}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div>
      <PageHeader label="F13 · ITR readiness pack" title={<>File with <span className="text-lime">{p.form.form}</span></>} description="A schedule-wise summary for you or your CA. FiscAI prepares it; you file on the income-tax portal."
        actions={<><Button variant="secondary" icon={<FileJson className="size-3.5" />} onClick={downloadJson}>JSON</Button><a href={`/api/itr/${ty}/pdf`}><Button icon={<Download className="size-3.5" />}>PDF</Button></a></>} />
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-center gap-3"><Chip tone="lime">{p.form.form}</Chip><span className="text-sm text-muted-fg">{p.form.reasons.join(' ')}</span><RuleChip ruleId="ITR-FORMS" className="ml-auto" /></div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader label="Schedule S" title="Salary" /><Rows rows={[['Employer', s.salary.employer ?? '—'], ['Gross salary', s.salary.gross], ['HRA exemption', s.salary.exemptions], ['Standard deduction', s.salary.standardDeduction], ['Net salary', s.salary.net]]} /></Card>
        <Card><CardHeader label="Schedule CG" title="Capital gains" /><Rows rows={[['STCG at slab', s.capitalGains.shortTermSlab], ['STCG 111A', s.capitalGains.shortTerm111A], ['LTCG 112A', s.capitalGains.longTerm112A], ['LTCG 112', s.capitalGains.longTerm112], ['LTCG indexed', s.capitalGains.longTermIndexed], ['Exempt (54/54F/54EC)', s.capitalGains.exemptions54]]} /></Card>
        <Card><CardHeader label="Schedule BP" title="Business / F&O" /><Rows rows={[['F&O turnover', s.businessIncome.fnoTurnover], ['F&O profit / (loss)', s.businessIncome.fnoProfit], ['Intraday turnover', s.businessIncome.speculativeTurnover], ['Intraday profit / (loss)', s.businessIncome.speculativeProfit], ['Presumptive', s.businessIncome.presumptive]]} /></Card>
        <Card><CardHeader label="Schedule OS · HP · VDA" title="Other income" /><Rows rows={[['Interest', s.otherSources.interest], ['Dividends', s.otherSources.dividends], ['House property', s.houseProperty.total], ['VDA gains', s.vda.gains]]} /></Card>
        <Card><CardHeader label="Schedule VI-A" title="Deductions" /><Rows rows={[...s.deductions.items.map((i) => [i.label, i.allowed] as [string, number]), ['Total', s.deductions.total]]} /></Card>
        <Card><CardHeader label="Schedule CFL" title="Losses carried forward" /><Rows rows={[['Short-term capital', s.carriedForwardLosses.stcl], ['Long-term capital', s.carriedForwardLosses.ltcl], ['Business', s.carriedForwardLosses.business], ['Speculative', s.carriedForwardLosses.speculative], ['House property', s.carriedForwardLosses.houseProperty]]} /></Card>
      </div>
      <Card className="mt-4"><CardHeader label="Computation" title="Tax payable" /><Rows rows={[['Total income', s.taxComputation.totalIncome], ['Slab tax', s.taxComputation.slabTax], ['Special-rate tax', s.taxComputation.specialTax], ['Rebate / relief', -s.taxComputation.rebate], ['Surcharge', s.taxComputation.surcharge], ['Cess', s.taxComputation.cess], ['Total tax', s.taxComputation.totalTax], ['Taxes paid', s.taxComputation.prepaid.total], [s.taxComputation.balance >= 0 ? 'Balance payable' : 'Refund due', Math.abs(s.taxComputation.balance)]]} /></Card>
      <p className="mt-4 text-xs text-muted-fg">{p.disclaimer}</p>
    </div>
  );
}
