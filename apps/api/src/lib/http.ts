import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'Validation failed', r.error.flatten());
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', details: err.flatten() });
  if ((err as any)?.name === 'MulterError') return res.status(400).json({ error: (err as Error).message });
  const msg = (err as Error)?.message ?? 'Internal error';
  if (/^(No rule pack|Only .* units available|Unknown scenario)/.test(msg)) return res.status(400).json({ error: msg });
  console.error('[api] unhandled error', err);
  res.status(500).json({ error: 'Something went wrong' });
}

export const taxYearParam = (v: unknown) => {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}$/.test(s)) throw new HttpError(400, 'Invalid tax year');
  return s as '2025-26' | '2026-27';
};

export const today = () => new Date().toISOString().slice(0, 10);
