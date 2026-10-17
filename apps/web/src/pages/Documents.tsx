import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, FileText, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Uploader } from '../components/Uploader';
import { Button, Card, CardHeader, Chip, EmptyState, Input, Modal, PageHeader, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { DOC_LABELS, fmtDate } from '../lib/format';

interface Doc { id: string; type: string; filename: string; size: number; status: string; error?: string; createdAt: string; fieldCount: number; lowConfidenceCount: number; method?: string; fileDeleted: boolean; warnings: string[] }

const STATUS: Record<string, { tone: 'lime' | 'orange' | 'danger' | 'muted' | 'default'; label: string }> = {
  uploaded: { tone: 'muted', label: 'Queued' }, parsing: { tone: 'default', label: 'Parsing' }, needs_review: { tone: 'orange', label: 'Needs review' }, confirmed: { tone: 'lime', label: 'Confirmed' }, failed: { tone: 'danger', label: 'Failed' },
};

export default function Documents() {
  const { taxYear } = useApp();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [retry, setRetry] = useState<Doc | null>(null);
  const [pw, setPw] = useState('');
  const docs = useQuery({
    queryKey: ['documents', taxYear],
    queryFn: () => api<{ documents: Doc[] }>(`/documents?taxYear=${taxYear}`),
    refetchInterval: (q) => (q.state.data?.documents.some((d) => d.status === 'uploaded' || d.status === 'parsing') ? 1500 : false),
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/documents/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); toast('Document deleted'); } });
  const doRetry = useMutation({ mutationFn: () => api(`/documents/${retry!.id}/retry`, { body: { password: pw || undefined } }), onSuccess: () => { setRetry(null); setPw(''); qc.invalidateQueries({ queryKey: ['documents'] }); } });

  return (
    <div>
      <PageHeader label="F2 · Smart document ingestion" title="Documents" description="Upload what you already have. FiscAI parses it, redacts identifiers before AI extraction, and asks you to review every field (low-confidence ones highlighted) before anything touches your profile." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Card className="h-fit">
          <CardHeader label="Upload" title="Add a document" />
          <div className="p-5"><Uploader onUploaded={(d) => { qc.invalidateQueries({ queryKey: ['documents'] }); toast('Uploaded — extracting fields'); nav(`/documents/${d.id}`); }} /></div>
        </Card>
        <Card>
          <CardHeader label={`Tax Year ${taxYear}`} title="Your documents" />
          {docs.data?.documents.length ? (
            <div className="divide-y divide-line">
              {docs.data.documents.map((d) => (
                <div key={d.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-md border border-line bg-card-2"><FileText className="size-4 text-muted-fg" /></div>
                    <div className="min-w-0">
                      <Link to={`/documents/${d.id}`} className="block truncate text-sm font-medium hover:text-lime">{d.filename}</Link>
                      <div className="text-xs text-muted-fg">{DOC_LABELS[d.type]} · {fmtDate(d.createdAt)} · {(d.size / 1024).toFixed(0)} KB{d.method ? ` · ${d.method}` : ''}{d.fileDeleted ? ' · raw file deleted' : ''}</div>
                      {d.error && <div className="mt-1 flex items-start gap-1 text-xs text-danger"><AlertCircle className="mt-px size-3 shrink-0" />{d.error}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(d.status === 'parsing' || d.status === 'uploaded') && <Loader2 className="size-3.5 animate-spin text-muted-fg" />}
                    {d.status === 'confirmed' && <CheckCircle2 className="size-3.5 text-lime" />}
                    <Chip tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Chip>
                    {d.status === 'needs_review' && <Link to={`/documents/${d.id}`}><Button size="sm">Review {d.fieldCount}{d.lowConfidenceCount ? ` · ${d.lowConfidenceCount} low` : ''}</Button></Link>}
                    {d.status === 'failed' && !d.fileDeleted && <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3" />} onClick={() => setRetry(d)}>Retry</Button>}
                    <button className="rounded p-1.5 text-muted-fg hover:bg-muted hover:text-danger" onClick={() => del.mutate(d.id)} aria-label="Delete"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={<FileText className="size-5" />} title="No documents yet" body="Start with Form 16, or a broker capital-gains report if you sold investments this year." />}
        </Card>
      </div>
      <Modal open={Boolean(retry)} onClose={() => setRetry(null)} title="Retry extraction">
        <p className="text-sm text-muted-fg">If the PDF is password-protected, enter the password. It is used once and never stored.</p>
        <Input className="mt-4" type="password" placeholder="PDF password (optional)" value={pw} onChange={(e) => setPw(e.target.value)} />
        <div className="mt-4 flex justify-end"><Button loading={doRetry.isPending} onClick={() => doRetry.mutate()}>Retry</Button></div>
      </Modal>
    </div>
  );
}
