import type { Prisma } from '../../generated/prisma/client';
import { HttpError } from '../../utils/http-error';

// Works with both the shared client and an interactive-transaction client.
export type Db = Prisma.TransactionClient;

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

export function notFound(what: string): HttpError {
  return new HttpError(404, 'NOT_FOUND', `${what} not found`);
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// Builds a URL slug from a name and appends -2, -3... until it is free.
export async function uniqueSlug(isTaken: (candidate: string) => Promise<boolean>, base: string, fallback: string): Promise<string> {
  const root = base || fallback;
  let candidate = root;
  for (let n = 2; await isTaken(candidate); n += 1) candidate = `${root}-${n}`;
  return candidate;
}
