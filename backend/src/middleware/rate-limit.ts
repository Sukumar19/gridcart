import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { HttpError } from '../utils/http-error';

const tooMany: RequestHandler = (_req, _res, next) => {
  next(new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Please try again in a few minutes.'));
};

const clientIp = (req: Request) => ipKeyGenerator(req.ip ?? '');

// Created per app instance so each app (and each test) gets its own counters.
export function createAuthLimiters() {
  return {
    // Only failed logins count, keyed by IP plus email, so one attacker cannot lock out a real customer elsewhere.
    login: rateLimit({
      windowMs: 15 * 60_000,
      limit: 10,
      skipSuccessfulRequests: true,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => `${clientIp(req)}|${String(req.body?.email ?? '').toLowerCase().slice(0, 255)}`,
      handler: tooMany,
    }),
    register: rateLimit({
      windowMs: 60 * 60_000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: clientIp,
      handler: tooMany,
    }),
  };
}
