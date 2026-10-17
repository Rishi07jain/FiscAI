import type { ExtractedField } from '@fiscai/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Card, CardHeader, Chip, cn, EmptyState, ErrorNote, Input, PageHeader, useToast } from '../components/ui';
import { api } from '../lib/api';
import { DOC_LABELS, inr } from '../lib/format';
import { useInvalidateProfile } from '../lib/queries';

interface DocResp {
  document: { id: string; type: string; filename: string; status: string; error?: string; method?: string; warnings: string[] };
  extractedFields: ExtractedField[];
  pagesPreview: { ref: string; text: string }[];
  lowConfidenceThreshold: number;
}

function highlight(text: string, needle: string) {
  if (!needle) return text;
  const variants = [needle, Number(needle).toLocaleString('en-IN'), Number(needle).toLocaleString('en-US')].filter((v) => v && v !== 'NaN');
  const re = new RegExp(`(${variants.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return text.split(re).map((part, i) => (variants.includes(part) ? <mark key={i} className="rounded bg-lime px-0.5 text-black">{part}</mark> : part));
}

export default function DocumentReview() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const inv = useInvalidateProfile();
  const q = useQuery({
    queryKey: ['document', id],
    queryFn: () => api<DocResp>(`/documents/${id}`),
    refetchInterval: (s) => (['uploaded', 'parsing'].includes(s.state.data?.document.status ?? '') ? 1200 : false),
  });
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => { if (q.data?.extractedFields) setFields(q.data.extractedFields.map((f) => ({ ...f, accepted: f.accepted !== false }))); }, [q.data?.extractedFields]);

  const confirm = useMutation({
    mutationFn: () => api(`/documents/${id}/confirm`, { body: { fields } }),
    onSuccess: async (r: any) => {
      await inv();
      qc.invalidateQueries({ queryKey: ['documents'] });
      const a = r.applied;
      toast(`Saved: ${a.scalars} profile fields${a.lots ? `, ${a.lots} lots` : ''}${a.fnoTrades ? `, ${a.fnoTrades} F&O trades` : ''}${a.aisEntries ? `, ${a.aisEntries} AIS rows` : ''}${a.vda ? `, ${a.vda} crypto txns` : ''}`);
      nav(sp.get('from') === 'onboarding' ? '/dashboard' : a.lots ? '/portfolio' : a.fnoTrades ? '/traders' : a.aisEntries ? '/ais' : '/dashboard');
    },
  });

  const threshold = q.data?.lowConfidenceThreshold ?? 0.8;
  const low = fields.filter((f) => f.confidence < threshold).length;
  const preview = useMemo(() => {
    if (active === null || !q.data) return null;
    const f = fields[active];
    const page = q.data.pagesPreview.find((p) => p.ref === f.sourceRef) ?? q.data.pagesPreview.find((p) => f.sourceRef.startsWith(p.ref));
    return { f, page };
  }, [active, fields, q.data]);

  if (q.isLoading) return <Loader2 className="size-5 animate-spin" />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!.document;
  const busy = d.status === 'uploaded' || d.status === 'parsing';

  return (
    <div>
      <Link to="/documents" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-fg hover:text-fg"><ArrowLeft className="size-3.5" />Documents</Link>
      <PageHeader label={`${DOC_LABELS[d.type]} · ${d.method ?? 'pending'}`} title={d.filename} description={d.status === 'needs_review' ? 'Check each value against the source. Untick anything wrong, or edit it. Nothing is saved until you confirm.' : undefined}
        actions={d.status === 'needs_review' && <Button loading={confirm.isPending} icon={<Check className="size-3.5" />} onClick={() => confirm.mutate()}>Confirm {fields.filter((f) => f.accepted !== false).length} fields</Button>} />
      {d.warnings?.map((w) => <div key={w} className="mb-3 flex items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn"><AlertTriangle className="size-3.5" />{w}</div>)}
      {busy && <Card><EmptyState icon={<Loader2 className="size-5 animate-spin" />} title="Extracting…" body="Parsing the file, redacting identifiers, and extracting fields into a strict schema." /></Card>}
      {d.status === 'failed' && <ErrorNote error={new Error(d.error ?? 'Extraction failed')} />}
      {d.status === 'confirmed' && <div className="mb-4 rounded-md border border-lime/30 bg-lime-soft px-3 py-2 text-sm text-lime">Confirmed and saved to your profile.</div>}
      {(d.status === 'needs_review' || d.status === 'confirmed') && (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card className="overflow-hidden">
            <CardHeader label="Extracted fields" title={`${fields.length} fields${low ? ` · ${low} need a closer look` : ''}`} />
            <div className="divide-y divide-line">
              {fields.map((f, i) => {
                const isLow = f.confidence < threshold;
                const isObj = typeof f.value === 'object' && f.value !== null;
                return (
                  <div key={i} onClick={() => setActive(i)} className={cn('grid cursor-pointer grid-cols-[auto_1fr] gap-3 px-5 py-3 transition-colors sm:grid-cols-[auto_1fr_auto]', active === i ? 'bg-card-2' : 'hover:bg-card-2/60', isLow && 'border-l-2 border-l-c2')}>
                    <input type="checkbox" disabled={d.status !== 'needs_review'} checked={f.accepted !== false} onClick={(e) => e.stopPropagation()} onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, accepted: e.target.checked } : x)))} className="mt-1 accent-[var(--primary)]" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className={cn(f.accepted === false && 'text-muted-fg line-through')}>{f.label}</span>
                        {isLow && <Chip tone="orange">Low confidence</Chip>}
                      </div>
                      <div className="mt-0.5 font-mono text-[0.65rem] text-muted-fg">{f.path}</div>
                      {isObj && <div className="mt-1 truncate font-mono text-[0.66rem] text-muted-fg/80">{JSON.stringify(f.value)}</div>}
                    </div>
                    <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
                      {!isObj && (
                        <Input disabled={d.status !== 'needs_review'} className="h-8 w-40 text-right tabular" value={String(f.value ?? '')} onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, value: typeof x.value === 'number' ? Number(e.target.value.replace(/[^\d.-]/g, '')) || 0 : e.target.value, confidence: 1 } : x)))} />
                      )}
                      <div className="w-20">
                        <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${f.confidence * 100}%`, background: isLow ? 'var(--chart-2)' : 'var(--primary)' }} /></div>
                        <div className="mt-1 text-right font-mono text-[0.6rem] text-muted-fg">{Math.round(f.confidence * 100)}% · {f.sourceRef}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card className="h-fit xl:sticky xl:top-20">
            <CardHeader label="Source preview" title={preview ? preview.f.sourceRef : 'Select a field'} />
            <div className="max-h-[60vh] overflow-y-auto p-5">
              {!preview ? <p className="text-sm text-muted-fg">Click a field to see the page or row it came from (identifiers redacted).</p>
                : preview.page ? <pre className="whitespace-pre-wrap font-mono text-[0.7rem] leading-relaxed text-muted-fg">{highlight(preview.page.text, typeof preview.f.value === 'number' ? String(preview.f.value) : '')}</pre>
                  : <p className="text-sm text-muted-fg">{d.status === 'confirmed' ? 'The raw file and preview were deleted after confirmation.' : 'No preview stored for this source.'}{typeof preview.f.value === 'number' && <> Value: {inr(preview.f.value)}</>}</p>}
            </div>
          </Card>
        </div>
      )}
      <ErrorNote error={confirm.error} />
    </div>
  );
}
