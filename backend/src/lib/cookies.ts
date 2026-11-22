import type { Response } from 'express';
import { env } from '../config/env';

const isProduction = env.NODE_ENV === 'production';

// The __Host- prefix makes browsers reject the cookie unless it is Secure, Path=/ and has no Domain.
export const SESSION_COOKIE = isProduction ? '__Host-gc_session' : 'gc_session';

export function setSessionCookie(res: Response, token: string, expires: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    expires,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
}
