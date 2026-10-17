import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../env';
import { HttpError } from '../lib/http';

export const COOKIE = 'fiscai_token';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { userId?: Types.ObjectId }
  }
}

export function signToken(userId: string) {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: '7d' });
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 3600 * 1000,
    path: '/',
  });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE] ?? (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined);
  if (!token) return next(new HttpError(401, 'Not signed in'));
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };
    req.userId = new Types.ObjectId(payload.sub);
    next();
  } catch {
    next(new HttpError(401, 'Session expired'));
  }
}

export const uid = (req: Request) => {
  if (!req.userId) throw new HttpError(401, 'Not signed in');
  return req.userId;
};
