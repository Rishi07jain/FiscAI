import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Card, CardHeader, Chip, Input, Modal, PageHeader, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { inr } from '../lib/format';
import { useRules } from '../lib/queries';

export default function Rules() {
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q);
  const { data, isLoading } = useRules(dq);
  const packs = useQuery({ queryKey: ['packs'], queryFn: () => api<{ packs: { id: string; act: string; taxYear: string; regime: string; effectiveFrom: string }[] }>('/rules/packs') });
  const [packId, setPackId] = useState<string | null>(null);
  const pack = useQuery({ queryKey: ['pack', packId], queryFn: () => api<{ pack: any }>(`/rules/packs/${packId}`), enabled: Boolean(packId) });
  return (
    <div>
      <PageHeader label="Rule library" title="The rules behind every number" description="Hand-written rule cards with both their Income-tax Act, 1961 and 2025 references, and the versioned rule packs the engine runs on. Section numbers marked TBC are pending verification against the new Act." />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {packs.data?.packs.map((p) => (
          <button key={p.id} onClick={() => setPackId(p.id)} className="rounded-lg border border-line bg-card p-4 text-left transition hover:border-lime/40">
            <div className="font-mono text-[0.68rem] text-lime">{p.id}</div>
            <div className="mt-1 text-sm">TY {p.taxYear} · {p.regime} regime</div>
            <div className="text-xs text-muted-fg">{p.act} · from {p.effectiveFrom}</div>
          </button>
        ))}
      </div>
      <div className="relative mb-4"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-fg" /><Input className="pl-9" placeholder="Search: HRA, 54EC, rebate, crypto, 234C…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {isLoading ? <Skeleton className="h-64" /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {data?.cards.map((c) => (
            <Card key={c.ruleId} className="p-5">
              <div className="flex items-start justify-between gap-3"><div className="font-medium">{c.title}</div><span className="font-mono text-[0.62rem] text-lime">{c.ruleId}</span></div>
              <div className="mt-2 flex flex-wrap gap-1.5"><Chip tone="muted">1961 · {c.refs.ita1961}</Chip><Chip tone={c.refs.ita2025 === 'TBC' ? 'orange' : 'muted'}>2025 · {c.refs.ita2025}</Chip>{c.status.includes('draft') && <Chip tone="orange">Draft rules</Chip>}</div>
              <p className="mt-3 text-sm leading-relaxed text-muted-fg">{c.body}</p>
              {c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-lime hover:underline">Source <ExternalLink className="size-3" /></a>}
            </Card>
          ))}
        </div>
      )}
      <Modal open={Boolean(packId)} onClose={() => setPackId(null)} title={packId} width="max-w-2xl">
        {pack.data ? (
          <div className="space-y-4 text-sm">
            <div>
              <div className="label-mono mb-2 text-muted-fg">Slabs (below 60)</div>
              {pack.data.pack.slabs.below60.map((s: any, i: number, arr: any[]) => <div key={i} className="flex justify-between border-b border-line py-1.5"><span className="text-muted-fg">{inr((arr[i - 1]?.upTo ?? 0) / 100)} – {s.upTo ? inr(s.upTo / 100) : 'above'}</span><span>{Math.round(s.rate * 100)}%</span></div>)}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><div className="label-mono text-muted-fg">Standard deduction</div>{inr(pack.data.pack.standardDeduction / 100)}</div>
              <div><div className="label-mono text-muted-fg">Rebate</div>{inr(pack.data.pack.rebate.maxRebate / 100)} up to {inr(pack.data.pack.rebate.maxIncome / 100)}</div>
              <div><div className="label-mono text-muted-fg">Equity LTCG</div>{pack.data.pack.specialRates.equityLTCG.rate * 100}% above {inr(pack.data.pack.specialRates.equityLTCG.exemption / 100)}</div>
              <div><div className="label-mono text-muted-fg">HRA metros</div>{pack.data.pack.hra.metros.length}</div>
            </div>
            <details><summary className="cursor-pointer text-xs text-muted-fg">Raw JSON (amounts in paise)</summary><pre className="mt-2 max-h-80 overflow-auto rounded-md bg-card-2 p-3 font-mono text-[0.65rem]">{JSON.stringify(pack.data.pack, null, 2)}</pre></details>
          </div>
        ) : <Skeleton className="h-40" />}
      </Modal>
    </div>
  );
}
