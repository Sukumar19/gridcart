import { z } from 'zod';

const slugList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) : undefined))
  .refine((list) => !list || list.every((s) => /^[a-z0-9-]{1,140}$/.test(s)), 'Use category slugs separated by commas');

const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

export const SORT_OPTIONS = ['relevance', 'newest', 'featured', 'price_asc', 'price_desc'] as const;

export const productListQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    type: slugList,
    occasion: slugList,
    recipient: slugList,
    personalised: flag,
    inStock: flag,
    minPrice: z.coerce.number().min(0).max(1_000_000).optional(),
    maxPrice: z.coerce.number().min(0).max(1_000_000).optional(),
    sort: z.enum(SORT_OPTIONS).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(48).default(12),
  })
  .refine((v) => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice, {
    path: ['minPrice'],
    message: 'Minimum price must not exceed maximum price',
  });

export const productSlugSchema = z.string().regex(/^[a-z0-9-]{1,220}$/, 'Invalid product link');

export type ProductListQuery = z.infer<typeof productListQuerySchema>;
