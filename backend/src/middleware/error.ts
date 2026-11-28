import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { HttpError } from '../utils/http-error';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the highlighted fields',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }

  // Upload limits (file too large, too many files, wrong field name).
  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'Each photo must be 8 MB or smaller' } });
    } else {
      res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: 'Upload up to 8 photos at a time in the "images" field' } });
    }
    return;
  }

  // body-parser errors (malformed JSON, oversized body) carry a 4xx status.
  const status: unknown = err?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'The request could not be read' } });
    return;
  }

  if (env.NODE_ENV !== 'test') console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
};
