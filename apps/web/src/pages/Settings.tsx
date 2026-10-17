import { useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Disclaimer } from '../components/Disclaimer';
import { Button, Card, CardHeader, Chip, ErrorNote, Field, Input, Modal, PageHeader, Switch, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { fmtDate } from '../lib/format';

export default function Settings() {
  const { user, refreshUser, config } = useApp();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const [confirmDel, setConfirmDel] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<unknown>(null);
  if (!user) return null;
  const patch = async (body: unknown) => {
    try { await api('/me', { method: 'PATCH', body }); await refreshUser(); toast('Saved'); } catch (e) { setError(e); }
  };
  const deleteAll = async () => {
    try { await api('/me', { method: 'DELETE' }); qc.clear(); nav('/'); } catch (e) { setError(e); }
  };
  return (
    <div className="max-w-3xl">
      <PageHeader label="Settings & privacy" title="Your data, your control" description="Consent, data export and account deletion, following the Digital Personal Data Protection Act, 2023: clear consent, purpose limitation, and deletion on request." />
      <div className="space-y-4">
        <Card>
          <CardHeader label="Account" title={user.email} />
          <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto]">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Button className="self-end" variant="secondary" onClick={() => patch({ name })}>Save</Button>
          </div>
          <div className="border-t border-line px-5 py-3 text-xs text-muted-fg">Member since {fmtDate(user.createdAt)}</div>
        </Card>
        <Card>
          <CardHeader label="Consent" title="What FiscAI may do" />
          <div className="space-y-5 p-5">
            <Switch checked={user.consentFlags.documentProcessing} onChange={(v) => patch({ consentFlags: { documentProcessing: v } })} label="Process uploaded documents" description="Extract tax data from files you upload. PAN, Aadhaar and account numbers are redacted from text before it reaches the AI model." />
            <Switch checked={user.consentFlags.keepUploadedFiles} onChange={(v) => patch({ consentFlags: { keepUploadedFiles: v } })} label="Keep original files after review" description="Off by default: raw files are deleted as soon as you confirm the extracted fields." />
            <Switch checked={user.consentFlags.emailReminders} onChange={(v) => patch({ consentFlags: { emailReminders: v } })} label="Email deadline reminders" description="30, 7 and 1 day before advance tax, 54EC, CGAS and ITR deadlines." />
          </div>
        </Card>
        <Card>
          <CardHeader label="Security" title="How your data is protected" />
          <ul className="space-y-2 p-5 text-sm text-muted-fg">
            <li>• Sensitive profile fields (name, PAN, employer, landlord details) are encrypted at rest with AES-256-GCM.</li>
            <li>• Sessions use an httpOnly cookie; every request is checked against your account.</li>
            <li>• Tax maths is done by a deterministic engine; the AI model never sees your PAN and never computes tax.</li>
          </ul>
          {config && <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3"><Chip tone={config.features.llm ? 'lime' : 'muted'}>LLM {config.features.llm ? 'on' : 'off'}</Chip><Chip tone="muted">queue · {config.features.queue}</Chip><Chip tone="muted">email · {config.features.email}</Chip><Chip tone="muted">retrieval · {config.features.vectorSearch}</Chip></div>}
        </Card>
        <Card>
          <CardHeader label="Your data" title="Export or delete" />
          <div className="flex flex-wrap gap-3 p-5">
            <a href="/api/me/export"><Button variant="secondary" icon={<Download className="size-3.5" />}>Export all data (JSON)</Button></a>
            <Button variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDel(true)}>Delete account & all data</Button>
          </div>
        </Card>
        <ErrorNote error={error} />
        <Disclaimer />
      </div>
      <Modal open={confirmDel} onClose={() => setConfirmDel(false)} title="Delete everything?">
        <p className="text-sm text-muted-fg">This permanently deletes your account, all tax profiles and versions, documents and files, portfolio lots, scenarios, chats and deadlines. It cannot be undone.</p>
        <Field label='Type "DELETE" to confirm' className="mt-4"><Input value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button><Button variant="danger" disabled={typed !== 'DELETE'} onClick={deleteAll}>Delete permanently</Button></div>
      </Modal>
    </div>
  );
}
