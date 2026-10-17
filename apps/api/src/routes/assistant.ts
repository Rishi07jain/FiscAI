import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { notFound, parse } from '../lib/http';
import { requireAuth, uid } from '../middleware/auth';
import { ChatSession } from '../models';
import { runAssistant, type AssistantEvent } from '../services/assistant';
import { getProfile } from '../services/profile';

export const assistantRouter = Router();
assistantRouter.use(requireAuth);
const limiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });

/** Assistant reply streamed over server-sent events. */
assistantRouter.post('/chat', limiter, async (req, res) => {
  const userId = uid(req);
  const body = parse(z.object({ message: z.string().min(1).max(4000), sessionId: z.string().optional(), taxYear: z.enum(['2025-26', '2026-27']).default('2026-27') }), req.body);
  let session = body.sessionId ? await ChatSession.findOne({ _id: body.sessionId, userId }) : null;
  if (!session) session = await ChatSession.create({ userId, taxYear: body.taxYear, title: body.message.slice(0, 80), messages: [], toolCalls: [] });
  const { profile } = await getProfile(userId, body.taxYear);

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('session', { sessionId: String(session._id) });

  const toolCalls: { name: string; args: unknown; result: unknown }[] = [];
  let scenario: unknown;
  const emit = (e: AssistantEvent) => {
    if (e.type === 'delta') send('delta', { text: e.text });
    else if (e.type === 'tool') { toolCalls.push({ name: e.name, args: e.args, result: e.summary }); send('tool', e); }
    else if (e.type === 'citations') send('citations', { cards: e.cards });
    else if (e.type === 'scenario') { scenario = { type: e.scenarioType, inputs: e.inputs, label: e.label }; send('scenario', scenario); }
  };
  const history = session.messages.map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text ?? '' }));
  try {
    const { text, citations } = await runAssistant(profile, history, body.message, emit);
    session.messages.push({ role: 'user', text: body.message } as any, { role: 'assistant', text, citations, scenario } as any);
    session.toolCalls.push(...(toolCalls as any));
    await session.save();
    send('done', { messageIndex: session.messages.length - 1 });
  } catch (e) {
    send('error', { error: /not configured/.test((e as Error).message) ? (e as Error).message : 'The assistant failed to answer. Please try again.' });
    console.error('[assistant]', e);
  }
  res.end();
});

assistantRouter.get('/sessions', async (req, res) => {
  const list = await ChatSession.find({ userId: uid(req) }, { title: 1, updatedAt: 1, taxYear: 1 }).sort({ updatedAt: -1 }).limit(50).lean();
  res.json({ sessions: list.map((s) => ({ id: String(s._id), title: s.title, taxYear: s.taxYear, updatedAt: s.updatedAt })) });
});

assistantRouter.get('/sessions/:id', async (req, res) => {
  const s = await ChatSession.findOne({ _id: req.params.id, userId: uid(req) }).lean();
  if (!s) throw notFound('Chat');
  res.json({ session: { id: String(s._id), title: s.title, taxYear: s.taxYear, messages: s.messages } });
});

assistantRouter.delete('/sessions/:id', async (req, res) => {
  await ChatSession.deleteOne({ _id: req.params.id, userId: uid(req) });
  res.json({ deleted: true });
});

/** "Clear and trustworthy" rating, used for the explanation-trust metric. */
assistantRouter.post('/feedback', async (req, res) => {
  const body = parse(z.object({ sessionId: z.string(), messageIndex: z.number().int().min(0), rating: z.union([z.literal(1), z.literal(-1)]) }), req.body);
  const r = await ChatSession.updateOne({ _id: body.sessionId, userId: uid(req) }, { $set: { [`messages.${body.messageIndex}.rating`]: body.rating } });
  if (!r.matchedCount) throw notFound('Chat');
  res.json({ ok: true });
});
