import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { SESSION_COOKIE } from '../src/lib/cookies';
import { hashToken } from '../src/lib/session-token';
import { closeDatabase, createUser, resetDatabase, TEST_PASSWORD } from './helpers';

const ORIGIN = 'http://localhost:3000';
let app: ReturnType<typeof createApp>;

const post = (url: string) => request(app).post(url).set('Origin', ORIGIN);
const cookieOf = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
const tokenOf = (res: request.Response) => cookieOf(res)?.split(';')[0]?.split('=')[1];

const validRegistration = {
  firstName: 'Asha',
  lastName: 'K',
  email: 'Asha@Example.com',
  password: 'Correct-horse-9',
  phone: '98765 43210',
};

beforeEach(async () => {
  app = createApp();
  await resetDatabase();
});

afterAll(closeDatabase);

describe('POST /api/auth/register', () => {
  it('creates a customer, normalises email and phone, and signs them in', async () => {
    const res = await post('/api/auth/register').send(validRegistration);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'asha@example.com', phone: '+919876543210', role: 'CUSTOMER', emailVerified: false });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);

    const cookie = cookieOf(res);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('stores an Argon2id hash, never the password, and only a hash of the session token', async () => {
    const res = await post('/api/auth/register').send(validRegistration);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'asha@example.com' } });
    const session = await prisma.authSession.findFirstOrThrow({ where: { userId: user.id } });

    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(user.passwordHash).not.toContain(validRegistration.password);
    expect(session.tokenHash).toBe(hashToken(tokenOf(res)!));
    expect(session.tokenHash).not.toBe(tokenOf(res));
    expect(session.tokenHash).toHaveLength(64);
  });

  it('ignores a role sent by the client (no privilege escalation)', async () => {
    const res = await post('/api/auth/register').send({ ...validRegistration, role: 'ADMIN', isActive: false });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CUSTOMER');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'asha@example.com' } });
    expect(user).toMatchObject({ role: 'CUSTOMER', isActive: true });
  });

  it('rejects a duplicate email regardless of letter case', async () => {
    await post('/api/auth/register').send(validRegistration).expect(201);
    const res = await post('/api/auth/register').send({ ...validRegistration, email: 'ASHA@example.COM' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it.each([
    ['short password', { password: 'abc' }, 'password'],
    ['common password', { password: 'password1' }, 'password'],
    ['password equal to email', { email: 'longpassword@example.com', password: 'longpassword@example.com' }, 'password'],
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['missing first name', { firstName: '' }, 'firstName'],
    ['non-Indian phone', { phone: '12345' }, 'phone'],
  ])('rejects %s with a field-level message', async (_name, patch, field) => {
    const res = await post('/api/auth/register').send({ ...validRegistration, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('answers malformed JSON with 400, not a server error', async () => {
    const res = await request(app).post('/api/auth/register').set('Origin', ORIGIN).set('Content-Type', 'application/json').send('{"bad json');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with the right password and records the login time', async () => {
    await createUser({ email: 'user@example.com' });
    const res = await post('/api/auth/login').send({ email: ' USER@example.com ', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('user@example.com');
    expect(cookieOf(res)).toMatch(/HttpOnly/i);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'user@example.com' } });
    expect(user.lastLoginAt).not.toBeNull();
  });

  it('gives the same generic error for a wrong password, an unknown email and a disabled account', async () => {
    await createUser({ email: 'user@example.com' });
    await createUser({ email: 'off@example.com', isActive: false });

    const wrongPassword = await post('/api/auth/login').send({ email: 'user@example.com', password: 'Wrong-password-1' });
    const unknownEmail = await post('/api/auth/login').send({ email: 'nobody@example.com', password: TEST_PASSWORD });
    const disabled = await post('/api/auth/login').send({ email: 'off@example.com', password: TEST_PASSWORD });

    for (const res of [wrongPassword, unknownEmail, disabled]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
      expect(cookieOf(res)).toBeUndefined();
    }
  });

  it('rate limits repeated failures for one email and still allows others', async () => {
    await createUser({ email: 'user@example.com' });
    await createUser({ email: 'other@example.com' });

    for (let i = 0; i < 10; i++) {
      await post('/api/auth/login').send({ email: 'user@example.com', password: 'Wrong-password-1' }).expect(401);
    }
    const blocked = await post('/api/auth/login').send({ email: 'user@example.com', password: TEST_PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    await post('/api/auth/login').send({ email: 'other@example.com', password: TEST_PASSWORD }).expect(200);
  });
});

describe('sessions', () => {
  it('GET /me needs a valid session and returns the signed-in user', async () => {
    await request(app).get('/api/auth/me').expect(401);

    const agent = request.agent(app);
    await agent.post('/api/auth/register').set('Origin', ORIGIN).send(validRegistration).expect(201);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('asha@example.com');
  });

  it('logout revokes the session on the server, so the old cookie stops working', async () => {
    await createUser();
    const login = await post('/api/auth/login').send({ email: 'user@example.com', password: TEST_PASSWORD });
    const cookie = cookieOf(login)!.split(';')[0]!;

    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    const out = await post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);

    const session = await prisma.authSession.findFirstOrThrow();
    expect(session.revokedAt).not.toBeNull();
  });

  it('logout without a session is harmless', async () => {
    await post('/api/auth/logout').expect(204);
  });

  it('rejects expired sessions, sessions of disabled users, and garbage cookies', async () => {
    const user = await createUser();
    const login = await post('/api/auth/login').send({ email: 'user@example.com', password: TEST_PASSWORD });
    const cookie = cookieOf(login)!.split(';')[0]!;

    await prisma.authSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);

    await prisma.authSession.updateMany({ data: { expiresAt: new Date(Date.now() + 3_600_000) } });
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);

    await request(app).get('/api/auth/me').set('Cookie', `${SESSION_COOKIE}=${'x'.repeat(500)}`).expect(401);
    await request(app).get('/api/auth/me').set('Cookie', `${SESSION_COOKIE}=not-a-real-token`).expect(401);
  });

  it('gives admins a shorter session than customers', async () => {
    await createUser({ email: 'admin@example.com', role: 'ADMIN' });
    await createUser({ email: 'user@example.com' });
    await post('/api/auth/login').send({ email: 'admin@example.com', password: TEST_PASSWORD }).expect(200);
    await post('/api/auth/login').send({ email: 'user@example.com', password: TEST_PASSWORD }).expect(200);

    const sessions = await prisma.authSession.findMany({ include: { user: true } });
    const hoursLeft = (role: string) => {
      const s = sessions.find((x) => x.user.role === role)!;
      return (s.expiresAt.getTime() - Date.now()) / 3_600_000;
    };
    expect(hoursLeft('ADMIN')).toBeLessThanOrEqual(8);
    expect(hoursLeft('CUSTOMER')).toBeGreaterThan(24 * 13);
  });
});

describe('role enforcement (server side)', () => {
  it('blocks anonymous users and customers from admin routes and lets admins in', async () => {
    await createUser({ email: 'admin@example.com', role: 'ADMIN' });
    await createUser({ email: 'user@example.com' });

    await request(app).get('/api/admin/ping').expect(401);

    const customer = await post('/api/auth/login').send({ email: 'user@example.com', password: TEST_PASSWORD });
    const customerCookie = cookieOf(customer)!.split(';')[0]!;
    const forbidden = await request(app).get('/api/admin/ping').set('Cookie', customerCookie);
    expect(forbidden.status).toBe(403);

    const admin = await post('/api/auth/login').send({ email: 'admin@example.com', password: TEST_PASSWORD });
    const adminCookie = cookieOf(admin)!.split(';')[0]!;
    const ok = await request(app).get('/api/admin/ping').set('Cookie', adminCookie);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, role: 'ADMIN' });
  });
});

describe('cross-site request protection', () => {
  it('rejects state-changing requests that come from another origin', async () => {
    await createUser();
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'user@example.com', password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
    expect(cookieOf(res)).toBeUndefined();
  });

  it('only allows CORS from the configured frontend', async () => {
    const allowed = await request(app).options('/api/auth/login').set('Origin', ORIGIN).set('Access-Control-Request-Method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const other = await request(app).options('/api/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});
