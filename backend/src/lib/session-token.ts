import { createHash, randomBytes } from 'node:crypto';

// 256 random bits; only the SHA-256 hash is stored, so a database leak cannot be replayed as a login.
export function newSessionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
