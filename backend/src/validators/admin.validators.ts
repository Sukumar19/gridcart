import { z } from 'zod';

// ------------------------------------------------------------ shared building blocks

export const uuidParam = z.uuid({ message: 'Invalid id' });

const text = (max: number) => z.string().trim().min(1, 'This field is required').max(max, `Use at most ${max} characters`);

// Optional text that the admin can clear: an empty string or null both mean "no value".
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .nullable()
    .transform((v) => (v === '' ? null : v));

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(140)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only');

// Money is accepted as a number or string and kept as a string so no float rounding can creep in.
const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount like 499 or 499.50'));

const page = z.coerce.number().int().min(1).max(10_000).default(1);

const bool = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

const MAX_STOCK = 1_000_000;

// ------------------------------------------------------------ variants

const variantFields = {
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._-]{1,63}$/, 'SKU may contain letters, numbers, dots, hyphens and underscores'),
  color: clearableText(50),
  colorHex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #FA6903')
    .nullable(),
  size: clearableText(30),
  price: money,
  compareAtPrice: money.nullable(),
  trackInventory: z.boolean(),
  lowStockThreshold: z.number().int().min(0).max(10_000),
  isDefault: z.boolean(),
  isActive: z.boolean(),
};

const compareAtNotBelowPrice = (v: { price?: string; compareAtPrice?: string | null }) =>
  v.price === undefined || v.compareAtPrice == null || Number(v.compareAtPrice) >= Number(v.price);

const compareAtIssue = { path: ['compareAtPrice'], message: 'The old price must not be lower than the selling price' };

export const variantCreateSchema = z
  .strictObject({
    sku: variantFields.sku.optional(),
    color: variantFields.color.optional(),
    colorHex: variantFields.colorHex.optional(),
    size: variantFields.size.optional(),
    price: variantFields.price,
    compareAtPrice: variantFields.compareAtPrice.optional(),
    trackInventory: variantFields.trackInventory.optional(),
    stockQuantity: z.number().int().min(0).max(MAX_STOCK).optional(),
    lowStockThreshold: variantFields.lowStockThreshold.optional(),
    isDefault: variantFields.isDefault.optional(),
    isActive: variantFields.isActive.optional(),
  })
  .refine(compareAtNotBelowPrice, compareAtIssue);

// Stock is deliberately absent: it can only change through the inventory endpoint so every change is logged.
export const variantUpdateSchema = z
  .strictObject({
    sku: variantFields.sku.optional(),
    color: variantFields.color.optional(),
    colorHex: variantFields.colorHex.optional(),
    size: variantFields.size.optional(),
    price: variantFields.price.optional(),
    compareAtPrice: variantFields.compareAtPrice.optional(),
    trackInventory: variantFields.trackInventory.optional(),
    lowStockThreshold: variantFields.lowStockThreshold.optional(),
    isDefault: variantFields.isDefault.optional(),
    isActive: variantFields.isActive.optional(),
  })
  .refine(compareAtNotBelowPrice, compareAtIssue);

// ------------------------------------------------------------ products

const productFields = {
  name: text(200),
  slug,
  description: clearableText(5000),
  isFeatured: z.boolean(),
  isCustomizable: z.boolean(),
  maxCustomImages: z.number().int().min(1).max(10),
  customizationNote: clearableText(500),
  hsnCode: z
    .string()
    .trim()
    .regex(/^\d{4}(\d{2}(\d{2})?)?$/, 'HSN code is 4, 6 or 8 digits')
    .nullable(),
  gstRate: z.number().min(0).max(100).multipleOf(0.01).nullable(),
};

export const productCreateSchema = z.strictObject({
  name: productFields.name,
  slug: productFields.slug.optional(),
  description: productFields.description.optional(),
  isFeatured: productFields.isFeatured.optional(),
  isCustomizable: productFields.isCustomizable.optional(),
  maxCustomImages: productFields.maxCustomImages.optional(),
  customizationNote: productFields.customizationNote.optional(),
  hsnCode: productFields.hsnCode.optional(),
  gstRate: productFields.gstRate.optional(),
  categoryIds: z.array(uuidParam).max(20).optional(),
  variant: variantCreateSchema.optional(),
});

export const productUpdateSchema = z.strictObject({
  name: productFields.name.optional(),
  slug: productFields.slug.optional(),
  description: productFields.description.optional(),
  isFeatured: productFields.isFeatured.optional(),
  isCustomizable: productFields.isCustomizable.optional(),
  maxCustomImages: productFields.maxCustomImages.optional(),
  customizationNote: productFields.customizationNote.optional(),
  hsnCode: productFields.hsnCode.optional(),
  gstRate: productFields.gstRate.optional(),
});

export const productCategoriesSchema = z.strictObject({
  categoryIds: z.array(uuidParam).max(20),
});

export const adminProductListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  type: z.string().trim().max(140).optional(),
  featured: bool,
  personalised: bool,
  incomplete: bool,
  sort: z.enum(['updated', 'created', 'name']).default('updated'),
  page,
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ------------------------------------------------------------ images

export const imageUpdateSchema = z.strictObject({
  altText: clearableText(255).optional(),
  variantId: uuidParam.nullable().optional(),
  isPrimary: z.literal(true).optional(),
});

export const imageOrderSchema = z.strictObject({
  imageIds: z.array(uuidParam).min(1).max(50),
});

// ------------------------------------------------------------ categories

export const categoryCreateSchema = z.strictObject({
  parentId: uuidParam,
  name: text(120),
  slug: slug.optional(),
  description: clearableText(1000).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});

export const categoryUpdateSchema = z.strictObject({
  name: text(120).optional(),
  slug: slug.optional(),
  description: clearableText(1000).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});

// ------------------------------------------------------------ inventory

export const stockChangeSchema = z
  .strictObject({
    mode: z.enum(['adjust', 'set']),
    quantity: z.number().int().min(-MAX_STOCK).max(MAX_STOCK),
    reason: z.enum(['RESTOCK', 'ADJUSTMENT', 'RETURN']).default('ADJUSTMENT'),
    note: clearableText(255).optional(),
  })
  .refine((v) => v.mode === 'adjust' || v.quantity >= 0, {
    path: ['quantity'],
    message: 'Stock cannot be set below zero',
  });

export const inventoryListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  state: z.enum(['all', 'attention', 'low', 'out', 'made_to_order']).default('all'),
  page,
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const historyQuerySchema = z.object({
  page,
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ------------------------------------------------------------ customers

export const customerListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page,
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const customerUpdateSchema = z.strictObject({
  isActive: z.boolean(),
});

// ------------------------------------------------------------ settings

export const shippingSettingsSchema = z.strictObject({
  flatFee: z.number().min(0).max(10_000).multipleOf(0.01),
  freeAbove: z.number().min(0).max(1_000_000).multipleOf(0.01).nullable(),
});

const days = z.number().int().min(0).max(120).nullable();

export const deliverySettingsSchema = z
  .strictObject({ minDays: days, maxDays: days, productionDays: days })
  .refine((v) => v.minDays === null || v.maxDays === null || v.minDays <= v.maxDays, {
    path: ['minDays'],
    message: 'Minimum days must not exceed maximum days',
  });

export const storeProfileSettingsSchema = z.strictObject({
  displayName: text(80),
  legalName: clearableText(200),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN')
    .nullable(),
  address: z.strictObject({
    line1: clearableText(255).transform((v) => v ?? ''),
    line2: clearableText(255),
    city: clearableText(100).transform((v) => v ?? ''),
    state: clearableText(100).transform((v) => v ?? ''),
    postalCode: z
      .string()
      .trim()
      .regex(/^([1-9]\d{5})?$/, 'Enter a 6-digit PIN code'),
    country: z.literal('IN').default('IN'),
  }),
  supportEmail: z.email('Enter a valid email address').max(255).nullable(),
  supportPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 -]{6,18}[0-9]$/, 'Enter a valid phone number')
    .nullable(),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type VariantCreateInput = z.infer<typeof variantCreateSchema>;
export type VariantUpdateInput = z.infer<typeof variantUpdateSchema>;
export type ImageUpdateInput = z.infer<typeof imageUpdateSchema>;
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
export type StockChangeInput = z.infer<typeof stockChangeSchema>;
export type AdminProductListQuery = z.infer<typeof adminProductListQuerySchema>;
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
