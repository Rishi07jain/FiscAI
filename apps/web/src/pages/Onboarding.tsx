import { CITY_OPTIONS } from '@fiscai/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HELP } from '../components/InfoTip';
import { Logo } from '../components/layout/Logo';
import { Uploader } from '../components/Uploader';
import { Button, Card, cn, ErrorNote, Field, MoneyInput, Select, Tabs } from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../lib/context';

const SOURCES = [
  ['salary', 'Salary'], ['capital_gains', 'Stocks / mutual funds'], ['fno', 'F&O / intraday'], ['rent', 'Rental income'], ['interest', 'FD / savings interest'], ['dividends', 'Dividends'], ['crypto', 'Crypto'], ['business', 'Freelance / business'],
] as const;

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex items-center justify-between rounded-md border px-4 py-3 text-left text-sm transition', active ? 'border-lime bg-lime-soft text-fg' : 'border-line bg-card-2 text-fg/85 hover:border-line-strong')}>
      {children}
      <span className={cn('grid size-4 place-items-center rounded-full border', active ? 'border-lime bg-lime text-black' : 'border-line-strong')}>{active && <Check className="size-2.5" />}</span>
    </button>
  );
}

export default function Onboarding() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { taxYear, refreshUser } = useApp();
  const [step, setStep] = useState(0);
  const [ageBand, setAgeBand] = useState('below60');
  const [city, setCity] = useState('Bengaluru');
  const [employmentType, setEmployment] = useState('salaried');
  const [rent, setRent] = useState(0);
  const [sources, setSources] = useState<string[]>(['salary']);
  const [path, setPath] = useState<'upload' | 'manual'>('manual');
  const [showMore, setShowMore] = useState(false);
  const [gross, setGross] = useState(0);
  const [basic, setBasic] = useState(0);
  const [hra, setHra] = useState(0);
  const [tds, setTds] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const save = async (manual: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/profiles/${taxYear}/onboarding`, { body: { ageBand, city, employmentType, monthlyRent: rent, incomeSources: sources, manualSalary: manual && gross > 0 ? (showMore ? { gross, basic: basic || undefined, hra: hra || undefined, tds } : { gross, tds: 0 }) : undefined } });
      await refreshUser();
      qc.invalidateQueries();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    { q: 'How old are you?', why: 'Seniors get a higher basic exemption in the old regime and different 80D limits.', body: (
      <div className="grid gap-2">{[['below60', 'Below 60'], ['60to79', '60 – 79'], ['80plus', '80 or above']].map(([v, l]) => <Choice key={v} active={ageBand === v} onClick={() => setAgeBand(v)}>{l}</Choice>)}</div>
    ) },
    { q: 'Which city do you live in?', why: 'From Tax Year 2026-27, Bengaluru, Hyderabad, Pune and Ahmedabad join the 50% HRA metro list.', body: (
      <Field label="City"><Select value={city} onChange={(e) => setCity(e.target.value)}>{CITY_OPTIONS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
    ) },
    { q: 'What best describes your work?', why: 'Business income (including F&O) changes how often you can switch regimes and which ITR you file.', body: (
      <div className="grid gap-2 sm:grid-cols-2">{[['salaried', 'Salaried'], ['self_employed', 'Self-employed / freelancer'], ['trader', 'Active trader'], ['retired', 'Retired / pensioner'], ['student', 'Student'], ['none', 'Other']].map(([v, l]) => <Choice key={v} active={employmentType === v} onClick={() => setEmployment(v)}>{l}</Choice>)}</div>
    ) },
    { q: 'How much rent do you pay each month?', why: 'Rent drives the HRA exemption in the old regime. Enter 0 if you own your home or live with family.', body: (
      <Field label="Monthly rent" info={{ what: 'What you pay your landlord each month. Enter 0 if you own your home or live with family.', where: 'Your rent agreement or a rent receipt.' }}><MoneyInput value={rent} onChange={setRent} /></Field>
    ) },
    { q: 'Where does your income come from?', why: 'Pick all that apply. FiscAI will only ask for the documents that matter.', body: (
      <div className="grid gap-2 sm:grid-cols-2">{SOURCES.map(([v, l]) => <Choice key={v} active={sources.includes(v)} onClick={() => setSources((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]))}>{l}</Choice>)}</div>
    ) },
  ];

  const last = step === steps.length;
  return (
    <div className="grid-bg min-h-screen">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6"><Logo /><span className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted-fg">Tax Year {taxYear}</span></div>
      <div className="mx-auto max-w-xl px-4 pb-16 pt-6">
        <div className="mb-8 flex gap-1.5">
          {[...steps, null].map((_, i) => <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-muted"><motion.div className="h-full bg-lime" initial={false} animate={{ width: i <= step ? '100%' : '0%' }} transition={{ duration: 0.35 }} /></div>)}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
            <div className="label-mono text-lime">{last ? 'Last step' : `Question ${step + 1} of ${steps.length}`}</div>
            {!last ? (
              <>
                <h1 className="mt-2 text-3xl font-normal tracking-tight">{steps[step].q}</h1>
                <p className="mt-2 text-sm text-muted-fg">{steps[step].why}</p>
                <div className="mt-6">{steps[step].body}</div>
              </>
            ) : (
              <>
                <h1 className="mt-2 text-3xl font-normal tracking-tight">How much do you earn?</h1>
                <p className="mt-2 text-sm text-muted-fg">Just your yearly salary is enough to start. Have a Form 16 from your employer? Upload it and we'll fill in the details for you.</p>
                <Tabs className="mt-6" value={path} onChange={setPath} options={[{ value: 'manual', label: 'Type my salary' }, { value: 'upload', label: 'Upload Form 16' }]} />
                <Card className="mt-4 p-5">
                  {path === 'upload' ? (
                    <Uploader defaultType="form16" onUploaded={async (doc) => { if (await save(false)) nav(`/documents/${doc.id}?from=onboarding`); }} />
                  ) : (
                    <div className="space-y-4">
                      <Field label="Your yearly salary (before tax)" info={HELP.yearlySalary} hint="A rough figure is fine — you can fine-tune it later.">
                        <MoneyInput value={gross} onChange={setGross} placeholder="e.g. 12,00,000" />
                      </Field>
                      <button type="button" onClick={() => setShowMore((v) => !v)} className="flex w-full items-center justify-between rounded-md border border-dashed border-line-strong px-3 py-2.5 text-left text-sm text-muted-fg transition hover:border-lime/50 hover:text-fg">
                        <span>{showMore ? 'Hide salary breakup' : 'I know my salary breakup'} <span className="text-xs">(optional — helps find savings)</span></span>
                        <ChevronDown className={cn('size-4 transition-transform', showMore && 'rotate-180')} />
                      </button>
                      <AnimatePresence initial={false}>
                        {showMore && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <div className="space-y-4 rounded-md border border-line bg-card-2 p-4">
                              <p className="text-xs text-muted-fg">Skip anything you're unsure of. Tap <span className="text-fg">ⓘ</span> to see what it means and where to find it.</p>
                              <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Basic salary (yearly)" info={HELP.basic} hint="Blank = we assume 40% of salary"><MoneyInput value={basic} onChange={setBasic} /></Field>
                                <Field label="HRA (yearly)" info={HELP.hra}><MoneyInput value={hra} onChange={setHra} /></Field>
                              </div>
                              <Field label="Tax already cut from your salary" info={HELP.tds} hint="Leave 0 to see the full tax for the year."><MoneyInput value={tds} onChange={setTds} /></Field>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      {!showMore && <p className="text-xs text-muted-fg">We'll show the full tax on your salary for the year (as if none has been paid yet), which regime is cheaper, and where you can save.</p>}
                      <Button className="w-full" size="lg" disabled={!gross} loading={busy} onClick={async () => { if (await save(true)) nav('/dashboard'); }}>See my tax</Button>
                    </div>
                  )}
                </Card>
                <button className="mt-4 text-sm text-muted-fg hover:text-fg" onClick={async () => { if (await save(false)) nav('/dashboard'); }}>Skip for now →</button>
              </>
            )}
          </motion.div>
        </AnimatePresence>
        <div className="mt-6"><ErrorNote error={error} /></div>
        <div className="mt-8 flex justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} icon={<ArrowLeft className="size-3.5" />}>Back</Button>
          {!last && <Button onClick={() => setStep((s) => s + 1)} disabled={step === 4 && !sources.length}>Continue <ArrowRight className="size-3.5" /></Button>}
        </div>
      </div>
    </div>
  );
}
