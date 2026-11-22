import type { RequestHandler } from 'express';
import type { UserRole } from '../generated/prisma/enums';
import { SESSION_COOKIE } from '../lib/cookies';
import { authenticate } from '../services/auth.service';
import { HttpError } from '../utils/http-error';

// Runs on every request: attaches req.auth when the session cookie is valid, otherwise leaves it unset.
export const loadSession: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token.length > 0 && token.length <= 128) {
    req.auth = (await authenticate(token)) ?? undefined;
  }
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
  next();
};

export function requireRole(role: UserRole): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
    if (req.auth.user.role !== role) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this');
    next();
  };
}
