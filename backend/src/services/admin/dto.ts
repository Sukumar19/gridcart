import type { Prisma } from '../../generated/prisma/client';
import { publicUrl } from '../../lib/storage';
import { money } from '../../utils/money';

type VariantRow = Prisma.ProductVariantGetPayload<object>;
type ImageRow = Prisma.ProductImageGetPayload<object>;

export function variantDto(v: VariantRow) {
  return {
    id: v.id,
    sku: v.sku,
    color: v.color,
    colorHex: v.colorHex,
    size: v.size,
    price: money(v.price),
    compareAtPrice: v.compareAtPrice ? money(v.compareAtPrice) : null,
    trackInventory: v.trackInventory,
    stockQuantity: v.stockQuantity,
    lowStockThreshold: v.lowStockThreshold,
    isDefault: v.isDefault,
    isActive: v.isActive,
  };
}

export function imageDto(i: ImageRow) {
  return {
    id: i.id,
    url: publicUrl(i.url),
    altText: i.altText,
    width: i.width,
    height: i.height,
    isPrimary: i.isPrimary,
    sortOrder: i.sortOrder,
    variantId: i.variantId,
  };
}

export const imageOrder = [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] satisfies Prisma.ProductImageOrderByWithRelationInput[];
export const variantOrder = [{ isDefault: 'desc' }, { createdAt: 'asc' }] satisfies Prisma.ProductVariantOrderByWithRelationInput[];
