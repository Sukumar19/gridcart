import { Router } from 'express';
import { login, logout, me, register } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth';
import { createAuthLimiters } from '../middleware/rate-limit';

export function createAuthRouter() {
  const limiters = createAuthLimiters();
  const router = Router();

  router.post('/register', limiters.register, register);
  router.post('/login', limiters.login, login);
  router.post('/logout', logout);
  router.get('/me', requireAuth, me);

  return router;
}
