import { ASSET_TYPES, CITY_OPTIONS, type TaxProfile } from '@fiscai/shared-types';
import { compareRegimes } from '@fiscai/tax-engine';
import { useQuery } from '@tanstack/react-query';
import { History, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { HELP } from '../components/InfoTip';
import { RuleChip } from '../components/RuleChip';
import { AnimatedNumber, Button, Card, CardHeader, Chip, cn, ErrorNote, Field, Input, Modal, MoneyInput, PageHeader, Select, Skeleton, Switch, Tabs, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { fmtDate, inr } from '../lib/format';
import { useInvalidateProfile, useProfile, useSaveProfile } from '../lib/queries';

type Section = 'personal' | 'salary' | 'house' | 'other' | 'gains' | 'business' | 'deductions' | 'paid';

const get = (o: any, path: string) => path.split('.').reduce((a, k) => a?.[k], o);
function setIn<T>(o: T, path: string, v: unknown): T {
  const c: any = structuredClone(o);
  const ks = path.split('.');
  let cur = c;
  for (const k of ks.slice(0, -1)) cur = cur[k] ??= {};
  cur[ks[ks.length - 1]] = v;
  return c;
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

const ASSET_LABEL: Record<string, string> = { listed_equity: 'Listed shares', equity_mf: 'Equity MF', debt_mf: 'Debt MF', property: 'House / flat', land: 'Land', unlisted_shares: 'Unlisted shares', gold: 'Gold / jewellery', sgb: 'Sovereign Gold Bond', listed_bond: 'Listed bond', buyback: 'Buyback tender', other: 'Other asset' };

export default function Profile() {
  const { taxYear } = useApp();
  const { data, isLoading, error } = useProfile();
  const save = useSaveProfile();
  const toast = useToast();
  const inv = useInvalidateProfile();
  const [draft, setDraft] = useState<TaxProfile | null>(null);
  const [section, setSection] = useState<Section>('personal');
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => { if (data) setDraft(structuredClone(data.profile)); }, [data]);
  const versions = useQuery({ queryKey: ['versions', taxYear], queryFn: () => api<{ versions: { version: number; source: string; changedPaths: string[]; createdAt: string }[] }>(`/profiles/${taxYear}/versions`), enabled: historyOpen });

  const preview = useMemo(() => { try { return draft ? compareRegimes(draft) : null; } catch { return null; } }, [draft]);
  const dirty = draft && data && JSON.stringify(draft) !== JSON.stringify(data.profile);

  if (isLoading || !draft) return <Skeleton className="h-96" />;
  if (error) return <ErrorNote error={error} />;

  const M = (path: string, label: string, hint?: ReactNode, opts: { negative?: boolean } = {}) => (
    <Field label={label} hint={hint} info={HELP[path.split('.').pop()!]}><MoneyInput value={get(draft, path) ?? 0} allowNegative={opts.negative} onChange={(v) => setDraft(setIn(draft, path, v))} /></Field>
  );
  const T = (path: string, label: string, hint?: string) => (
    <Field label={label} hint={hint}><Input value={get(draft, path) ?? ''} onChange={(e) => setDraft(setIn(draft, path, e.target.value))} /></Field>
  );

  const sections: { value: Section; label: string }[] = [
    { value: 'personal', label: 'Personal' }, { value: 'salary', label: 'Salary' }, { value: 'house', label: 'House' }, { value: 'other', label: 'Other income' },
    { value: 'gains', label: 'Capital gains' }, { value: 'business', label: 'Business / F&O' }, { value: 'deductions', label: 'Deductions' }, { value: 'paid', label: 'Taxes paid' },
  ];

  const onSave = async () => {
    await save.mutateAsync(draft);
    toast('Profile saved as a new version');
  };

  return (
    <div>
      <PageHeader label={`F1 · Tax profile · v${data?.version ?? 0}`} title="Your tax profile" description="Every field is editable and every save is versioned. The preview on the right recomputes instantly in your browser with the same engine the server uses."
        actions={<><Button variant="secondary" icon={<History className="size-3.5" />} onClick={() => setHistoryOpen(true)}>History</Button><Button icon={<Save className="size-3.5" />} disabled={!dirty} loading={save.isPending} onClick={onSave}>Save</Button></>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <div className="mb-4 overflow-x-auto pb-1"><Tabs value={section} onChange={setSection} options={sections} /></div>
          <Card className="p-5">
            {section === 'personal' && (
              <Grid>
                <Field label="Regime you will file under" hint={<RuleChip ruleId="REGIME-NEW" />}>
                  <Select value={draft.regime} onChange={(e) => setDraft(setIn(draft, 'regime', e.target.value))}><option value="new">New regime (default)</option><option value="old">Old regime</option></Select>
                </Field>
                <Field label="Age"><Select value={draft.personal.ageBand} onChange={(e) => setDraft(setIn(draft, 'personal.ageBand', e.target.value))}><option value="below60">Below 60</option><option value="60to79">60 – 79</option><option value="80plus">80+</option></Select></Field>
                <Field label="Residency"><Select value={draft.personal.residency} onChange={(e) => setDraft(setIn(draft, 'personal.residency', e.target.value))}><option value="resident">Resident</option><option value="rnor">Resident but not ordinarily resident</option><option value="nri">Non-resident (limited support)</option></Select></Field>
                <Field label="City" hint="Drives HRA metro status"><Select value={CITY_OPTIONS.includes(draft.personal.city) ? draft.personal.city : 'Other'} onChange={(e) => setDraft(setIn(draft, 'personal.city', e.target.value))}>{CITY_OPTIONS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                <Field label="Employment"><Select value={draft.personal.employmentType} onChange={(e) => setDraft(setIn(draft, 'personal.employmentType', e.target.value))}>{[['salaried', 'Salaried'], ['self_employed', 'Self-employed'], ['trader', 'Trader'], ['retired', 'Retired'], ['student', 'Student'], ['none', 'Other']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                {T('personal.name', 'Name (encrypted at rest)')}
                {T('personal.pan', 'PAN (encrypted at rest)', 'Never sent to the AI model')}
                <div className="sm:col-span-2 lg:col-span-3"><Switch checked={draft.personal.parentsSenior} onChange={(v) => setDraft(setIn(draft, 'personal.parentsSenior', v))} label="A parent is 60 or older" description="Raises the 80D limit for parents' health insurance to Rs 50,000." /></div>
              </Grid>
            )}
            {section === 'salary' && (
              <div className="space-y-5">
                <Grid>
                  {T('salary.employerName', 'Employer (encrypted)')}
                  {M('salary.basic', 'Basic salary (annual)')}
                  {M('salary.da', 'Dearness allowance')}
                  {M('salary.hra', 'HRA received', <RuleChip ruleId="HRA" />)}
                  {M('salary.specialAllowance', 'Special allowance')}
                  {M('salary.otherAllowances', 'Other allowances')}
                  {M('salary.bonus', 'Bonus / incentives')}
                  {M('salary.perquisites', 'Perquisites (17(2))')}
                  {M('salary.employerNps', 'Employer NPS contribution', <RuleChip ruleId="DED-80CCD2" />)}
                  {M('salary.professionalTax', 'Professional tax')}
                  {M('salary.rentPaid', 'Rent paid (annual)')}
                  {T('salary.landlordRelation', 'Landlord relationship', 'Required for HRA claims from TY 2026-27')}
                </Grid>
                {preview && <div className="rounded-md border border-line bg-card-2 px-4 py-3 text-sm text-muted-fg">Old regime HRA exemption: <span className="text-fg">{inr(preview.old.income.salary.hraExempt)}</span> ({preview.old.income.salary.isMetro ? '50% metro' : '40% non-metro'} rule)</div>}
              </div>
            )}
            {section === 'house' && (
              <div className="space-y-5">
                <Grid>{M('houseProperty.selfOccupiedInterest', 'Home-loan interest — self-occupied', <RuleChip ruleId="HP-24B" />)}{M('deductions.homeLoanPrincipal', 'Home-loan principal repaid', 'Counts within 80C (old regime)')}</Grid>
                <div>
                  <div className="mb-2 flex items-center justify-between"><div className="label-mono text-muted-fg">Let-out properties</div><Button size="sm" variant="secondary" icon={<Plus className="size-3" />} onClick={() => setDraft({ ...draft, houseProperty: { ...draft.houseProperty, letOut: [...draft.houseProperty.letOut, { label: 'Flat', annualRent: 0, municipalTax: 0, homeLoanInterest: 0 }] } })}>Add</Button></div>
                  {draft.houseProperty.letOut.map((p, i) => (
                    <div key={i} className="mb-3 grid gap-3 rounded-md border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                      {(['label', 'annualRent', 'municipalTax', 'homeLoanInterest'] as const).map((k) => (
                        <Field key={k} label={{ label: 'Name', annualRent: 'Annual rent', municipalTax: 'Municipal tax', homeLoanInterest: 'Loan interest' }[k]}>
                          {k === 'label' ? <Input value={p.label} onChange={(e) => setDraft(setIn(draft, `houseProperty.letOut.${i}.label`, e.target.value))} /> : <MoneyInput value={p[k]} onChange={(v) => setDraft(setIn(draft, `houseProperty.letOut.${i}.${k}`, v))} />}
                        </Field>
                      ))}
                      <button className="self-end p-2 text-muted-fg hover:text-danger" onClick={() => setDraft({ ...draft, houseProperty: { ...draft.houseProperty, letOut: draft.houseProperty.letOut.filter((_, j) => j !== i) } })}><Trash2 className="size-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {section === 'other' && <Grid>{M('otherIncome.savingsInterest', 'Savings-account interest')}{M('otherIncome.fdInterest', 'FD / RD interest')}{M('otherIncome.dividends', 'Dividends', <RuleChip ruleId="DIV-INT-DED" />)}{M('otherIncome.familyPension', 'Family pension')}{M('otherIncome.other', 'Other income')}</Grid>}
            {section === 'gains' && (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm text-muted-fg">Sales during the Tax Year. Holding periods, set-off and exemptions are applied automatically. Portfolio-synced rows are marked.</p>
                  <Button size="sm" variant="secondary" icon={<Plus className="size-3" />} onClick={() => setDraft({ ...draft, capitalGains: [...draft.capitalGains, { label: '', assetType: 'listed_equity', buyDate: `${Number(taxYear.slice(0, 4)) - 1}-04-01`, sellDate: `${taxYear.slice(0, 4)}-06-01`, cost: 0, saleValue: 0, expenses: 0, improvements: [], sttPaid: true, isResidentialHouse: false, promoter: false, reinvest: { sec54: 0, sec54F: 0, sec54EC: 0 } }] })}>Add sale</Button>
                </div>
                <div className="space-y-3">
                  {draft.capitalGains.map((t, i) => {
                    const r = preview?.[draft.regime].income.capitalGains.txns[i];
                    const isProp = t.assetType === 'property' || t.assetType === 'land';
                    return (
                      <div key={i} className="rounded-md border border-line p-3">
                        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                          <Field label="Label"><Input value={t.label} onChange={(e) => setDraft(setIn(draft, `capitalGains.${i}.label`, e.target.value))} /></Field>
                          <Field label="Asset"><Select value={t.assetType} onChange={(e) => setDraft(setIn(draft, `capitalGains.${i}.assetType`, e.target.value))}>{ASSET_TYPES.map((a) => <option key={a} value={a}>{ASSET_LABEL[a]}</option>)}</Select></Field>
                          <Field label="Bought"><Input type="date" value={t.buyDate} onChange={(e) => setDraft(setIn(draft, `capitalGains.${i}.buyDate`, e.target.value))} /></Field>
                          <Field label="Sold"><Input type="date" value={t.sellDate} onChange={(e) => setDraft(setIn(draft, `capitalGains.${i}.sellDate`, e.target.value))} /></Field>
                          <Field label="Cost"><MoneyInput value={t.cost} onChange={(v) => setDraft(setIn(draft, `capitalGains.${i}.cost`, v))} /></Field>
                          <Field label="Sale value"><MoneyInput value={t.saleValue} onChange={(v) => setDraft(setIn(draft, `capitalGains.${i}.saleValue`, v))} /></Field>
                        </div>
                        {(isProp || t.assetType === 'sgb') && (
                          <div className="mt-3 grid gap-3 sm:grid-cols-4">
                            {isProp && <>
                              <Field label="Transfer expenses"><MoneyInput value={t.expenses} onChange={(v) => setDraft(setIn(draft, `capitalGains.${i}.expenses`, v))} /></Field>
                              <Field label="Sec 54 (new house)"><MoneyInput value={t.reinvest.sec54} onChange={(v) => setDraft(setIn(draft, `capitalGains.${i}.reinvest.sec54`, v))} /></Field>
                              <Field label="Sec 54EC bonds"><MoneyInput value={t.reinvest.sec54EC} onChange={(v) => setDraft(setIn(draft, `capitalGains.${i}.reinvest.sec54EC`, v))} /></Field>
                              <div className="self-end pb-2"><Switch checked={t.isResidentialHouse} onChange={(v) => setDraft(setIn(draft, `capitalGains.${i}.isResidentialHouse`, v))} label="Residential house" /></div>
                            </>}
                            {t.assetType === 'sgb' && <Field label="How you hold it"><Select value={t.sgbRoute ?? 'secondary_market'} onChange={(e) => setDraft(setIn(draft, `capitalGains.${i}.sgbRoute`, e.target.value))}><option value="original_issue_held_to_maturity">Original issue, held to maturity</option><option value="secondary_market">Bought on exchange, redeemed</option><option value="exchange_sale">Sold on exchange</option></Select></Field>}
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            {t.id?.startsWith('lot:') && <Chip tone="muted">From portfolio</Chip>}
                            {r && <><Chip tone={r.term === 'long' ? 'lime' : 'orange'}>{r.term}-term</Chip><span className="text-muted-fg">{r.bucket} · gain {inr(r.gain)}{r.indexation ? ` · ${r.indexation.chosen} chosen` : ''}</span>{r.ruleIds[0] && <RuleChip ruleId={r.ruleIds[0]} />}</>}
                          </div>
                          <button className="text-muted-fg hover:text-danger" onClick={() => setDraft({ ...draft, capitalGains: draft.capitalGains.filter((_, j) => j !== i) })}><Trash2 className="size-3.5" /></button>
                        </div>
                      </div>
                    );
                  })}
                  {!draft.capitalGains.length && <p className="py-8 text-center text-sm text-muted-fg">No sales recorded. Import from the Portfolio page or add one here.</p>}
                </div>
              </div>
            )}
            {section === 'business' && <Grid>{M('business.fnoTurnover', 'F&O turnover', <RuleChip ruleId="FNO-BUSINESS" />)}{M('business.fnoProfit', 'F&O net profit / (loss)', 'Negative for a loss', { negative: true })}{M('business.speculativeTurnover', 'Intraday turnover')}{M('business.speculativeProfit', 'Intraday profit / (loss)', <RuleChip ruleId="SPEC-INTRADAY" />, { negative: true })}{M('business.presumptiveIncome', 'Presumptive income (44AD/ADA)')}{M('business.otherBusinessProfit', 'Other business profit', undefined, { negative: true })}</Grid>}
            {section === 'deductions' && (
              <div className="space-y-5">
                {draft.regime === 'new' && <div className="rounded-md border border-c2/30 bg-c2/10 px-4 py-3 text-sm text-c2">You're on the new regime: these deductions only count if you switch to the old regime (employer NPS, under Salary, works in both).</div>}
                <Grid>{M('deductions.sec80C', '80C investments', <RuleChip ruleId="DED-80C" />)}{M('deductions.sec80CCD1B', 'Own NPS (80CCD(1B))', <RuleChip ruleId="DED-80CCD1B" />)}{M('deductions.healthSelf', 'Health insurance — self & family', <RuleChip ruleId="DED-80D" />)}{M('deductions.healthParents', 'Health insurance — parents')}{M('deductions.preventiveCheckup', 'Preventive check-ups')}{M('deductions.sec80E', 'Education-loan interest', <RuleChip ruleId="DED-80E" />)}{M('deductions.sec80G', 'Donations (eligible amount)', <RuleChip ruleId="DED-80G" />)}</Grid>
                <div className="label-mono pt-2 text-muted-fg">Brought-forward losses</div>
                <Grid>{M('broughtForwardLosses.stcl', 'Short-term capital loss')}{M('broughtForwardLosses.ltcl', 'Long-term capital loss')}{M('broughtForwardLosses.business', 'Business (F&O) loss')}{M('broughtForwardLosses.speculative', 'Speculative loss')}{M('broughtForwardLosses.houseProperty', 'House-property loss')}</Grid>
              </div>
            )}
            {section === 'paid' && <Grid>{M('taxesPaid.tds', 'TDS (salary, bank, etc.)')}{M('taxesPaid.tcs', 'TCS')}{M('taxesPaid.advanceTax', 'Advance tax (lump sum)', 'Or log dated payments in the Planner')}{M('taxesPaid.selfAssessment', 'Self-assessment tax')}</Grid>}
          </Card>
          <ErrorNote error={save.error} />
        </div>

        <div className="xl:sticky xl:top-20 xl:h-fit">
          <Card>
            <CardHeader label="Live preview" title="Recomputed as you type" />
            {preview && (
              <div className="space-y-3 p-5">
                {(['new', 'old'] as const).map((k) => (
                  <div key={k} className={cn('rounded-md border p-3', preview.recommended === k ? 'border-lime/40 bg-lime-soft' : 'border-line')}>
                    <div className="flex justify-between"><span className="label-mono text-muted-fg">{k}{draft.regime === k && ' · yours'}</span>{preview.recommended === k && <span className="font-mono text-[0.58rem] text-lime">LOWER</span>}</div>
                    <div className="mt-1 text-xl font-light"><AnimatedNumber value={preview[k].totalTax} format={(n) => inr(n)} /></div>
                  </div>
                ))}
                <div className="text-xs text-muted-fg">{preview[draft.regime].balance >= 0 ? 'Payable' : 'Refund'}: <span className="text-fg">{inr(Math.abs(preview[draft.regime].balance))}</span></div>
                {dirty && <Button className="w-full" loading={save.isPending} onClick={onSave}>Save changes</Button>}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Version history" width="max-w-xl">
        <div className="space-y-2">
          {versions.data?.versions.map((v) => (
            <div key={v.version} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm">v{v.version} <span className="text-muted-fg">· {v.source}</span></div>
                <div className="truncate text-xs text-muted-fg">{fmtDate(v.createdAt)} · {v.changedPaths.slice(0, 4).join(', ')}{v.changedPaths.length > 4 ? '…' : ''}</div>
              </div>
              {v.version !== data?.version && <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3" />} onClick={async () => { await api(`/profiles/${taxYear}/versions/${v.version}/restore`, { method: 'POST' }); await inv(); toast(`Restored v${v.version} as a new version`); setHistoryOpen(false); }}>Restore</Button>}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
