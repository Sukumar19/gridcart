import { Router } from 'express';
import { requireRole } from '../middleware/auth';

export const adminRouter = Router();

// Every route registered below is ADMIN-only; the role is checked on the server, not just hidden in the UI.
adminRouter.use(requireRole('ADMIN'));

adminRouter.get('/ping', (req, res) => {
  res.json({ ok: true, role: req.auth?.user.role });
});
