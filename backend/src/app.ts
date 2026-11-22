import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { loadSession } from './middleware/auth';
import { errorHandler, notFound } from './middleware/error';
import { requireTrustedOrigin } from './middleware/same-origin';
import { adminRouter } from './routes/admin.routes';
import { createAuthRouter } from './routes/auth.routes';
import { healthRouter } from './routes/health.routes';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Render sits in front of the app; trust one proxy hop so req.ip and secure cookies work.
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', requireTrustedOrigin);
  app.use(loadSession);

  app.use('/api/health', healthRouter);
  app.use('/api/auth', createAuthRouter());
  app.use('/api/admin', adminRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
