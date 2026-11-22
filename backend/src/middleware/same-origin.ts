import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { HttpError } from '../utils/http-error';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const allowedOrigin = new URL(env.FRONTEND_URL).origin;

// Second line of CSRF defence next to SameSite=Lax cookies: browsers always send Origin on cross-site writes.
export const requireTrustedOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== allowedOrigin) {
    throw new HttpError(403, 'BAD_ORIGIN', 'Request origin is not allowed');
  }
  next();
};
