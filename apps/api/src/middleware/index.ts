import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../lib/db';
import { HttpError } from '../lib/errors';
import { logger } from '../lib/logger';

export interface AuthedRequest extends Request { userId?: string }

export const wrap = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req as AuthedRequest, res).catch(next); };

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(new HttpError(401, 'Missing bearer token'));
  try {
    const p = jwt.verify(h.slice(7), env.JWT_SECRET) as { sub: string };
    req.userId = p.sub;
    next();
  } catch { next(new HttpError(401, 'Invalid or expired token')); }
}

export const hashKey = (k: string) => crypto.createHash('sha256').update(k).digest('hex');

/** Ingestion accepts either a user JWT or a data-source API key (x-api-key). */
export function requireIngestAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'];
  if (typeof key !== 'string') return requireAuth(req, res, next);
  prisma.apiCredential.findUnique({ where: { keyHash: hashKey(key) } })
    .then(async (cred) => {
      if (!cred || cred.revokedAt) return next(new HttpError(401, 'Invalid or revoked API key'));
      await prisma.apiCredential.update({ where: { id: cred.id }, data: { lastUsedAt: new Date() } });
      next();
    })
    .catch(next);
}

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'Validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ ok: false, error: { message: err.message, details: err.details } });
  if (err instanceof ZodError) return res.status(400).json({ ok: false, error: { message: 'Validation failed', details: err.issues } });
  if ((err as { type?: string }).type === 'entity.too.large') return res.status(413).json({ ok: false, error: { message: 'Payload too large' } });
  logger.error(err);
  res.status(500).json({ ok: false, error: { message: 'Internal server error' } });
}
