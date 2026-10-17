import crypto from 'node:crypto';
import { env } from '../env';

const PREFIX = 'enc:v1:';

function key(): Buffer {
  const raw = env.ENCRYPTION_KEY;
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
    return buf;
  }
  if (env.NODE_ENV === 'production') throw new Error('ENCRYPTION_KEY is required in production');
  return crypto.createHash('sha256').update(`fiscai-dev:${env.JWT_SECRET}`).digest();
}

/** AES-256-GCM application-level encryption for sensitive fields. */
export function encrypt(plain: string | undefined | null): string | undefined {
  if (plain === undefined || plain === null || plain === '') return plain ?? undefined;
  if (plain.startsWith(PREFIX)) return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

export function decrypt(value: string | undefined | null): string | undefined {
  if (!value || !value.startsWith(PREFIX)) return value ?? undefined;
  const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

/** Profile paths holding personal identifiers; encrypted at rest. */
export const SENSITIVE_PROFILE_PATHS = ['personal.name', 'personal.pan', 'salary.employerName', 'salary.landlordPan', 'salary.landlordRelation'];

function walk(obj: any, path: string, fn: (v: string) => string | undefined) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur?.[parts[i]];
    if (!cur) return;
  }
  const last = parts[parts.length - 1];
  if (typeof cur[last] === 'string') cur[last] = fn(cur[last]);
}

export function encryptProfile<T>(profile: T): T {
  const copy = structuredClone(profile);
  for (const p of SENSITIVE_PROFILE_PATHS) walk(copy, p, (v) => encrypt(v)!);
  return copy;
}

export function decryptProfile<T>(profile: T): T {
  const copy = structuredClone(profile);
  for (const p of SENSITIVE_PROFILE_PATHS) walk(copy, p, (v) => decrypt(v)!);
  return copy;
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
