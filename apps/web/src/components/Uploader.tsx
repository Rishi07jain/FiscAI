import { DOCUMENT_TYPES } from '@fiscai/shared-types';
import { motion } from 'motion/react';
import { FileUp, Lock, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { DOC_LABELS } from '../lib/format';
import { Button, cn, ErrorNote, Field, Input, Select, Switch } from './ui';

const ACCEPT: Record<string, string> = {
  form16: '.pdf', ais: '.pdf,.json', broker_pnl: '.csv,.xlsx,.pdf', mf_cas: '.pdf,.csv,.xlsx', salary_slip: '.pdf,.png,.jpg,.jpeg,.webp', rent_receipt: '.pdf,.png,.jpg,.jpeg,.webp', crypto_statement: '.csv,.xlsx,.pdf',
};

export function Uploader({ defaultType = 'form16', lockType, onUploaded }: { defaultType?: string; lockType?: boolean; onUploaded: (doc: { id: string }) => void }) {
  const { taxYear, user } = useApp();
  const [type, setType] = useState(defaultType);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(Boolean(user?.consentFlags.keepUploadedFiles));
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', type);
      fd.append('taxYear', taxYear);
      fd.append('keepFile', String(keep));
      if (password) fd.append('password', password);
      const r = await api('/documents', { form: fd });
      onUploaded(r.document);
      setFile(null);
      setPassword('');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const isPdf = file?.name.toLowerCase().endsWith('.pdf');
  return (
    <div className="space-y-4">
      {!lockType && (
        <Field label="Document type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOC_LABELS[t]}</option>)}
          </Select>
        </Field>
      )}
      <motion.div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
        onClick={() => input.current?.click()}
        animate={{ scale: drag ? 1.01 : 1 }}
        className={cn('flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center transition-colors', drag ? 'border-lime bg-lime-soft' : 'border-line-strong bg-card-2 hover:border-lime/50')}
      >
        <input ref={input} type="file" hidden accept={ACCEPT[type]} onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
        {file ? (
          <>
            <FileUp className="size-7 text-lime" />
            <div className="mt-3 text-sm font-medium">{file.name}</div>
            <div className="mt-1 text-xs text-muted-fg">{(file.size / 1024).toFixed(0)} KB · click to change</div>
          </>
        ) : (
          <>
            <UploadCloud className="size-7 text-muted-fg" />
            <div className="mt-3 text-sm">Drop your {DOC_LABELS[type]} here, or <span className="text-lime">browse</span></div>
            <div className="mt-1 font-mono text-[0.62rem] uppercase tracking-wider text-muted-fg">{ACCEPT[type].replaceAll('.', '').replaceAll(',', ' · ')} · max 15 MB</div>
          </>
        )}
      </motion.div>
      {isPdf && (
        <Field label="PDF password (if protected)" hint="Form 16 and CAS PDFs are often protected with your PAN or date of birth. Used once, never stored.">
          <div className="relative"><Lock className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-fg" /><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-8" autoComplete="off" /></div>
        </Field>
      )}
      <Switch checked={keep} onChange={setKeep} label="Keep the original file" description="Off by default: the raw file is deleted as soon as you confirm the extracted fields." />
      {!user?.consentFlags.documentProcessing && <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">Document processing consent is off. Turn it on in Settings to upload.</div>}
      <ErrorNote error={error} />
      <Button onClick={submit} disabled={!file} loading={busy} className="w-full" icon={<UploadCloud className="size-4" />}>Upload & extract</Button>
    </div>
  );
}
