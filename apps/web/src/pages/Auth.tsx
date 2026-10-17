import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Disclaimer } from '../components/Disclaimer';
import { Logo } from '../components/layout/Logo';
import { Button, Card, ErrorNote, Field, Input } from '../components/ui';
import { api } from '../lib/api';

export default function Auth({ mode }: { mode: 'login' | 'register' }) {
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [terms, setTerms] = useState(false);
  const [docConsent, setDocConsent] = useState(true);
  const [reminders, setReminders] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = mode === 'login'
        ? await api('/auth/login', { body: { email, password } })
        : await api('/auth/register', { body: { email, password, name, consent: { terms, documentProcessing: docConsent, emailReminders: reminders } } });
      qc.setQueryData(['me'], r.user);
      nav(r.user.onboardedAt ? ((loc.state as any)?.from ?? '/dashboard') : '/onboarding', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-bg flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6"><Logo /></div>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <div className="label-mono text-lime">{mode === 'login' ? 'Welcome back' : 'Create account'}</div>
          <h1 className="mt-2 text-3xl font-normal tracking-tight">{mode === 'login' ? 'Log in to FiscAI' : 'Start planning your tax'}</h1>
          <Card className="mt-6 p-6">
            <form onSubmit={submit} className="space-y-4">
              {mode === 'register' && <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Priya" /></Field>}
              <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
              <Field label="Password" hint={mode === 'register' ? 'At least 8 characters' : undefined}><Input type="password" required minLength={mode === 'register' ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></Field>
              {mode === 'register' && (
                <div className="space-y-2.5 rounded-md border border-line bg-card-2 p-3.5 text-[0.8rem]">
                  <div className="label-mono text-muted-fg">Consent (DPDP Act, 2023)</div>
                  <label className="flex items-start gap-2.5"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 accent-[var(--primary)]" required /><span>I accept the terms and understand FiscAI gives estimates, not professional tax advice.</span></label>
                  <label className="flex items-start gap-2.5"><input type="checkbox" checked={docConsent} onChange={(e) => setDocConsent(e.target.checked)} className="mt-0.5 accent-[var(--primary)]" /><span>Process documents I upload to extract tax data. Identifiers are redacted before AI extraction and raw files are deleted after review.</span></label>
                  <label className="flex items-start gap-2.5"><input type="checkbox" checked={reminders} onChange={(e) => setReminders(e.target.checked)} className="mt-0.5 accent-[var(--primary)]" /><span>Email me deadline reminders (30, 7 and 1 day before).</span></label>
                </div>
              )}
              <ErrorNote error={error} />
              <Button type="submit" className="w-full" size="lg" loading={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</Button>
            </form>
          </Card>
          <p className="mt-5 text-center text-sm text-muted-fg">
            {mode === 'login' ? <>New to FiscAI? <Link to="/register" className="text-lime hover:underline">Create an account</Link></> : <>Already have an account? <Link to="/login" className="text-lime hover:underline">Log in</Link></>}
          </p>
          <div className="mt-8"><Disclaimer compact /></div>
        </motion.div>
      </div>
    </div>
  );
}
