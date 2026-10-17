import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { decryptProfile } from '../lib/crypto';
import { HttpError, parse } from '../lib/http';
import { COOKIE, requireAuth, setAuthCookie, signToken, uid } from '../middleware/auth';
import { ALL_USER_COLLECTIONS, DocumentModel, User } from '../models';
import { deleteFile } from '../services/storage';

export const authRouter = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

const publicUser = (u: any) => ({
  id: String(u._id), email: u.email, name: u.name, consentFlags: u.consentFlags, activeTaxYear: u.activeTaxYear,
  onboardedAt: u.onboardedAt, metrics: u.metrics, createdAt: u.createdAt,
});

const Register = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Use at least 8 characters'),
  name: z.string().max(80).default(''),
  consent: z.object({ terms: z.literal(true, { errorMap: () => ({ message: 'Please accept the terms' }) }), documentProcessing: z.boolean().default(false), emailReminders: z.boolean().default(true) }),
});

authRouter.post('/register', authLimiter, async (req, res) => {
  const body = parse(Register, req.body);
  if (await User.exists({ email: body.email.toLowerCase() })) throw new HttpError(409, 'An account with this email already exists');
  const user = await User.create({
    email: body.email, name: body.name, passwordHash: await bcrypt.hash(body.password, 12),
    consentFlags: { ...body.consent, keepUploadedFiles: false, consentedAt: new Date() },
  });
  setAuthCookie(res, signToken(String(user._id)));
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = parse(z.object({ email: z.string().email(), password: z.string() }), req.body);
  const user = await User.findOne({ email: body.email.toLowerCase() });
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) throw new HttpError(401, 'Incorrect email or password');
  setAuthCookie(res, signToken(String(user._id)));
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get('/', async (req, res) => {
  const u = await User.findById(uid(req)).lean();
  if (!u) throw new HttpError(401, 'Account not found');
  res.json({ user: publicUser(u) });
});

meRouter.patch('/', async (req, res) => {
  const body = parse(z.object({
    name: z.string().max(80).optional(),
    activeTaxYear: z.enum(['2025-26', '2026-27']).optional(),
    consentFlags: z.object({ documentProcessing: z.boolean().optional(), emailReminders: z.boolean().optional(), keepUploadedFiles: z.boolean().optional() }).optional(),
  }), req.body);
  const set: Record<string, unknown> = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.activeTaxYear) set.activeTaxYear = body.activeTaxYear;
  for (const [k, v] of Object.entries(body.consentFlags ?? {})) if (v !== undefined) set[`consentFlags.${k}`] = v;
  const u = await User.findByIdAndUpdate(uid(req), { $set: set }, { new: true }).lean();
  res.json({ user: publicUser(u) });
});

/** DPDP: export everything we hold about the user. */
meRouter.get('/export', async (req, res) => {
  const userId = uid(req);
  const user = await User.findById(userId, { passwordHash: 0 }).lean();
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), user };
  for (const M of ALL_USER_COLLECTIONS) {
    const rows = await (M as any).find({ userId }).lean();
    out[M.collection.collectionName] = rows.map((r: any) => (r.data ? { ...r, data: decryptProfile(r.data) } : r));
  }
  res.setHeader('Content-Disposition', 'attachment; filename="fiscai-export.json"');
  res.json(out);
});

/** DPDP: delete the account and all data in one action. */
meRouter.delete('/', async (req, res) => {
  const userId = uid(req);
  const docs = await DocumentModel.find({ userId, fileRef: { $exists: true } }, { fileRef: 1 }).lean();
  await Promise.all(docs.map((d) => deleteFile(d.fileRef as any)));
  for (const M of ALL_USER_COLLECTIONS) await (M as any).deleteMany({ userId });
  await User.deleteOne({ _id: userId });
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ deleted: true });
});
