import type { Request, Response } from 'express';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from '../lib/cookies';
import { loginUser, logoutSession, registerUser, toPublicUser, type SessionMeta } from '../services/auth.service';
import { loginSchema, registerSchema } from '../validators/auth.validators';

function sessionMeta(req: Request): SessionMeta {
  return { userAgent: req.get('user-agent')?.slice(0, 255) ?? null, ip: req.ip ?? null };
}

export async function register(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);
  const { user, token, expiresAt } = await registerUser(input, sessionMeta(req));
  setSessionCookie(res, token, expiresAt);
  res.status(201).json({ user: toPublicUser(user) });
}

export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const { user, token, expiresAt } = await loginUser(input, sessionMeta(req));
  setSessionCookie(res, token, expiresAt);
  res.json({ user: toPublicUser(user) });
}

export async function logout(req: Request, res: Response) {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token.length > 0) await logoutSession(token);
  clearSessionCookie(res);
  res.status(204).end();
}

export function me(req: Request, res: Response) {
  res.json({ user: toPublicUser(req.auth!.user) });
}
