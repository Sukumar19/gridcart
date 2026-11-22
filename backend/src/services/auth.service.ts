import { env } from '../config/env';
import { Prisma, type User } from '../generated/prisma/client';
import { hashPassword, verifyPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { hashToken, newSessionToken } from '../lib/session-token';
import type { LoginInput, RegisterInput } from '../validators/auth.validators';
import { HttpError } from '../utils/http-error';

export interface SessionMeta {
  userAgent: string | null;
  ip: string | null;
}

export function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt,
  };
}

function sessionExpiry(role: User['role']): Date {
  const ms = role === 'ADMIN' ? env.ADMIN_SESSION_TTL_HOURS * 3_600_000 : env.SESSION_TTL_DAYS * 86_400_000;
  return new Date(Date.now() + ms);
}

// Verifying against a real hash when the email is unknown keeps response time the same either way.
let dummyHash: Promise<string> | undefined;
function getDummyHash() {
  dummyHash ??= hashPassword('not-a-real-password');
  return dummyHash;
}

export async function registerUser(input: RegisterInput, meta: SessionMeta) {
  const passwordHash = await hashPassword(input.password);
  const { token, tokenHash } = newSessionToken();
  const expiresAt = sessionExpiry('CUSTOMER');

  try {
    const user = await prisma.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName || null,
        email: input.email,
        phone: input.phone ?? null,
        passwordHash,
        role: 'CUSTOMER',
        sessions: { create: { tokenHash, userAgent: meta.userAgent, ip: meta.ip, expiresAt } },
      },
    });
    return { user, token, expiresAt };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw err;
  }
}

export async function loginUser(input: LoginInput, meta: SessionMeta) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const passwordOk = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), input.password);

  if (!user || !user.isActive || !passwordOk) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  const { token, tokenHash } = newSessionToken();
  const expiresAt = sessionExpiry(user.role);

  const [updated] = await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    prisma.authSession.create({
      data: { userId: user.id, tokenHash, userAgent: meta.userAgent, ip: meta.ip, expiresAt },
    }),
  ]);

  return { user: updated, token, expiresAt };
}

export async function authenticate(token: string) {
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) return null;
  return { sessionId: session.id, user: session.user };
}

export async function logoutSession(token: string) {
  await prisma.authSession.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
