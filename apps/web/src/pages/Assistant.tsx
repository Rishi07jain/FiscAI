import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Bot, Cpu, FlaskConical, MessageSquarePlus, Square, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { RuleChip } from '../components/RuleChip';
import { Button, Card, Chip, cn, PageHeader, useToast } from '../components/ui';
import { api, streamSSE } from '../lib/api';
import { useApp } from '../lib/context';
import type { RuleCard } from '../lib/queries';

interface Msg { role: 'user' | 'assistant'; text: string; citations?: RuleCard[]; tools?: { name: string; summary: string }[]; scenario?: { type: string; inputs: unknown; label: string }; rating?: number; index?: number; error?: string }

const SUGGESTIONS = [
  'Should I switch to the old regime if I buy health insurance for my parents?',
  'How much tax will I pay if I sell 100 Infosys shares bought in March 2025 at ₹1,500, now at ₹1,900?',
  'Bengaluru is now an HRA metro — how does that change my tax?',
  'When is my next advance tax instalment and how much?',
  'Can my F&O losses reduce tax on my salary?',
];

/** Minimal, safe markdown: bold, bullets, paragraphs, and [RULE-ID] citations as chips. */
function Rich({ text }: { text: string }) {
  const inline = (s: string, k: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|\[[A-Z0-9]+(?:-[A-Z0-9]+)+\]|_[^_]+_)/g).map((part, i) => {
      if (/^\*\*.+\*\*$/.test(part)) return <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong>;
      if (/^\[[A-Z0-9-]+\]$/.test(part)) return <RuleChip key={`${k}-${i}`} ruleId={part.slice(1, -1)} className="mx-0.5 align-middle" />;
      if (/^_.+_$/.test(part)) return <em key={`${k}-${i}`} className="text-muted-fg">{part.slice(1, -1)}</em>;
      return <Fragment key={`${k}-${i}`}>{part}</Fragment>;
    });
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="prose-chat text-[0.9rem] leading-relaxed">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''), `${i}-${j}`)}</li>)}</ul>;
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l.replace(/^#+\s*/, ''), `${i}-${j}`)}</Fragment>)}</p>;
      })}
    </div>
  );
}

export default function Assistant() {
  const { taxYear, config } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const sessions = useQuery({ queryKey: ['chat-sessions'], queryFn: () => api<{ sessions: { id: string; title: string; updatedAt: string }[] }>('/assistant/sessions') });
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);

  const load = async (id: string) => {
    const r = await api<{ session: { messages: any[] } }>(`/assistant/sessions/${id}`);
    const cards = await Promise.all(r.session.messages.map(async (m) => (m.citations?.length ? Promise.all(m.citations.map((c: string) => api<{ card: RuleCard }>(`/rules/${c}`).then((x) => x.card).catch(() => null))) : [])));
    setSessionId(id);
    setMsgs(r.session.messages.map((m, i) => ({ role: m.role, text: m.text, scenario: m.scenario, rating: m.rating, index: i, citations: (cards[i] as (RuleCard | null)[]).filter(Boolean) as RuleCard[] })));
  };

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setInput('');
    setBusy(true);
    setMsgs((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '', tools: [] }]);
    const patchLast = (f: (m: Msg) => Msg) => setMsgs((m) => [...m.slice(0, -1), f(m[m.length - 1])]);
    abort.current = new AbortController();
    try {
      await streamSSE('/assistant/chat', { message: text, sessionId, taxYear }, (ev, data) => {
        if (ev === 'session') setSessionId(data.sessionId);
        else if (ev === 'delta') patchLast((m) => ({ ...m, text: m.text + data.text }));
        else if (ev === 'tool') patchLast((m) => ({ ...m, tools: [...(m.tools ?? []), { name: data.name, summary: data.summary }] }));
        else if (ev === 'citations') patchLast((m) => ({ ...m, citations: data.cards }));
        else if (ev === 'scenario') patchLast((m) => ({ ...m, scenario: data }));
        else if (ev === 'done') patchLast((m) => ({ ...m, index: data.messageIndex }));
        else if (ev === 'error') patchLast((m) => ({ ...m, error: data.error }));
      }, abort.current.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') patchLast((m) => ({ ...m, error: (e as Error).message }));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ['chat-sessions'] });
    }
  };

  const rate = async (m: Msg, rating: 1 | -1) => {
    if (!sessionId || m.index === undefined) return;
    await api('/assistant/feedback', { body: { sessionId, messageIndex: m.index, rating } });
    setMsgs((all) => all.map((x) => (x === m ? { ...x, rating } : x)));
    toast('Thanks — feedback recorded');
  };

  return (
    <div>
      <PageHeader label="F6 · Explainable assistant" title={<>Ask in plain language. <span className="text-lime">Get the rule.</span></>} description="The assistant never does tax arithmetic. It calls the rules engine for every number and cites a rule card with both Act references."
        actions={<Button variant="secondary" icon={<MessageSquarePlus className="size-3.5" />} onClick={() => { setSessionId(undefined); setMsgs([]); }}>New chat</Button>} />
      {config && !config.features.llm && <div className="mb-4 rounded-md border border-warn/30 bg-warn/10 px-4 py-2.5 text-xs text-warn">GEMINI_API_KEY is not set on the server, so answers come straight from the engine and rule cards (no language model).</div>}
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card className="hidden h-fit max-h-[70vh] overflow-y-auto p-2 lg:block">
          <div className="label-mono px-2 py-2 text-muted-fg">History</div>
          {sessions.data?.sessions.map((s) => (
            <div key={s.id} className={cn('group flex items-center rounded-md', s.id === sessionId ? 'bg-card-2' : 'hover:bg-card-2/60')}>
              <button onClick={() => load(s.id)} className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm text-muted-fg group-hover:text-fg">{s.title}</button>
              <button className="p-1.5 text-muted-fg opacity-0 hover:text-danger group-hover:opacity-100" onClick={async () => { await api(`/assistant/sessions/${s.id}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['chat-sessions'] }); if (s.id === sessionId) { setMsgs([]); setSessionId(undefined); } }}><Trash2 className="size-3" /></button>
            </div>
          ))}
          {!sessions.data?.sessions.length && <div className="px-2 pb-2 text-xs text-muted-fg">No chats yet.</div>}
        </Card>

        <Card className="flex min-h-[70vh] flex-col">
          <div className="flex-1 space-y-6 overflow-y-auto p-5">
            {!msgs.length && (
              <div className="py-8">
                <div className="mx-auto grid size-12 place-items-center rounded-xl border border-lime/30 bg-lime-soft text-lime"><Bot className="size-5" /></div>
                <div className="mt-4 text-center text-sm text-muted-fg">Try one of these</div>
                <div className="mx-auto mt-4 grid max-w-2xl gap-2">
                  {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} className="rounded-md border border-line bg-card-2 px-4 py-2.5 text-left text-sm text-fg/85 transition hover:border-lime/40 hover:text-fg">{s}</button>)}
                </div>
              </div>
            )}
            <AnimatePresence initial={false}>
              {msgs.map((m, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn('flex gap-3', m.role === 'user' && 'justify-end')}>
                  {m.role === 'assistant' && <div className="grid size-7 shrink-0 place-items-center rounded-md border border-lime/30 bg-lime-soft text-lime"><Bot className="size-3.5" /></div>}
                  <div className={cn('max-w-[85%]', m.role === 'user' ? 'rounded-lg rounded-tr-sm bg-lime px-4 py-2.5 text-[0.9rem] text-black' : 'min-w-0 flex-1')}>
                    {m.role === 'user' ? m.text : (
                      <>
                        {!!m.tools?.length && (
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {m.tools.map((t, k) => <span key={k} className="inline-flex items-center gap-1 rounded border border-line bg-card-2 px-2 py-0.5 font-mono text-[0.62rem] text-muted-fg"><Cpu className="size-2.5 text-lime" />{t.name} · {t.summary}</span>)}
                          </div>
                        )}
                        {m.text ? <Rich text={m.text} /> : !m.error && <div className="flex gap-1 py-2">{[0, 1, 2].map((d) => <motion.span key={d} className="size-1.5 rounded-full bg-muted-fg" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: d * 0.15 }} />)}</div>}
                        {m.error && <div className="mt-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{m.error}</div>}
                        {!!m.citations?.length && (
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {m.citations.map((c) => (
                              <div key={c.ruleId} className="rounded-md border border-line bg-card-2 p-3">
                                <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{c.title}</span><RuleChip ruleId={c.ruleId} /></div>
                                <div className="mt-1 font-mono text-[0.6rem] text-muted-fg">1961 · {c.refs.ita1961} &nbsp;|&nbsp; 2025 · {c.refs.ita2025}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {(m.scenario || m.index !== undefined) && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {m.scenario && <Button size="sm" variant="outline-lime" icon={<FlaskConical className="size-3" />} onClick={() => nav(`/scenarios?type=${m.scenario!.type}&inputs=${encodeURIComponent(JSON.stringify(m.scenario!.inputs))}`)}>Open as scenario</Button>}
                            {m.index !== undefined && (
                              <span className="ml-auto flex items-center gap-1 text-xs text-muted-fg">Clear & trustworthy?
                                <button onClick={() => rate(m, 1)} className={cn('rounded p-1 hover:text-lime', m.rating === 1 && 'text-lime')}><ThumbsUp className="size-3.5" /></button>
                                <button onClick={() => rate(m, -1)} className={cn('rounded p-1 hover:text-danger', m.rating === -1 && 'text-danger')}><ThumbsDown className="size-3.5" /></button>
                              </span>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={end} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="border-t border-line p-3">
            <div className="flex items-end gap-2 rounded-lg border border-line bg-card-2 p-2 focus-within:border-lime/60">
              <textarea rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} placeholder={`Ask about Tax Year ${taxYear}…`} className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-fg" />
              {busy ? <Button type="button" size="sm" variant="secondary" onClick={() => abort.current?.abort()} icon={<Square className="size-3" />}>Stop</Button> : <Button type="submit" size="sm" disabled={!input.trim()} icon={<ArrowUp className="size-3.5" />}>Send</Button>}
            </div>
            <div className="mt-2 flex items-center gap-2 px-1 text-[0.68rem] text-muted-fg"><Chip tone="muted">no arithmetic by the model</Chip>Out-of-scope questions (NRI, company tax, stock picks) are flagged with a suggestion to consult a CA.</div>
          </form>
        </Card>
      </div>
    </div>
  );
}
