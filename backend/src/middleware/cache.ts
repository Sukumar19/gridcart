import type { RequestHandler } from 'express';

// Public catalogue data is the same for everyone, so browsers and a CDN may reuse it briefly.
export function publicCache(seconds: number): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`);
    next();
  };
}
