import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/http-error';
import { money } from '../../utils/money';
import type { InventoryListQuery, StockChangeInput } from '../../validators/admin.validators';
import { notFound, paginate } from './shared';

type StockState = 'OK' | 'LOW' | 'OUT' | 'MADE_TO_ORDER';

function stockState(v: { trackInventory: boolean; stockQuantity: number; lowStockThreshold: number }): StockState {
  if (!v.trackInventory) return 'MADE_TO_ORDER';
  if (v.stockQuantity === 0) return 'OUT';
  return v.stockQuantity <= v.lowStockThreshold ? 'LOW' : 'OK';
}

const stateFilters: Record<InventoryListQuery['state'], (s: StockState) => boolean> = {
  all: () => true,
  attention: (s) => s === 'LOW' || s === 'OUT',
  low: (s) => s === 'LOW',
  out: (s) => s === 'OUT',
  made_to_order: (s) => s === 'MADE_TO_ORDER',
};

const stateRank: Record<StockState, number> = { OUT: 0, LOW: 1, OK: 2, MADE_TO_ORDER: 3 };

export async function listInventory(query: InventoryListQuery) {
  const variants = await prisma.productVariant.findMany({
    where: {
      product: { status: { not: 'ARCHIVED' } },
      ...(query.q && {
        OR: [
          { sku: { contains: query.q, mode: 'insensitive' } },
          { product: { name: { contains: query.q, mode: 'insensitive' } } },
        ],
      }),
    },
    include: { product: { select: { id: true, name: true, slug: true, status: true } } },
  });

  const rows = variants
    .map((v) => ({
      variantId: v.id,
      sku: v.sku,
      color: v.color,
      size: v.size,
      price: money(v.price),
      isActive: v.isActive,
      trackInventory: v.trackInventory,
      stockQuantity: v.stockQuantity,
      lowStockThreshold: v.lowStockThreshold,
      state: stockState(v),
      product: v.product,
    }))
    .sort((a, b) => stateRank[a.state] - stateRank[b.state] || a.product.name.localeCompare(b.product.name) || a.sku.localeCompare(b.sku));

  const summary = {
    out: rows.filter((r) => r.state === 'OUT').length,
    low: rows.filter((r) => r.state === 'LOW').length,
  };

  return { ...paginate(rows.filter((r) => stateFilters[query.state](r.state)), query.page, query.pageSize), summary };
}

// The row is locked while we read and change it, so two simultaneous adjustments can never lose an update.
export async function changeStock(variantId: string, input: StockChangeInput, adminId: string) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ stock_quantity: number; track_inventory: boolean }[]>`
      SELECT stock_quantity, track_inventory FROM product_variants WHERE id = ${variantId}::uuid FOR UPDATE`;
    const current = rows[0];
    if (!current) throw notFound('Variant');
    if (!current.track_inventory) {
      throw new HttpError(409, 'NOT_TRACKED', 'This variant is made to order, so it has no stock count. Turn on stock tracking first.');
    }

    const before = current.stock_quantity;
    const after = input.mode === 'set' ? input.quantity : before + input.quantity;
    if (after < 0) throw new HttpError(409, 'INSUFFICIENT_STOCK', `Stock cannot go below zero. There are ${before} in stock now.`);

    const change = after - before;
    if (change === 0) throw new HttpError(400, 'NO_CHANGE', 'The stock is already at that number');
    if (change < 0 && (input.reason === 'RESTOCK' || input.reason === 'RETURN')) {
      throw new HttpError(400, 'REASON_MISMATCH', 'A restock or return must increase the stock');
    }

    await tx.productVariant.update({ where: { id: variantId }, data: { stockQuantity: after } });
    await tx.inventoryTransaction.create({
      data: { variantId, quantityChange: change, stockAfter: after, reason: input.reason, createdById: adminId, note: input.note ?? null },
    });

    return { variantId, stockBefore: before, stockAfter: after, change };
  });
}

export async function stockHistory(variantId: string, page: number, pageSize: number) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, sku: true, stockQuantity: true, product: { select: { name: true } } },
  });
  if (!variant) throw notFound('Variant');

  const [total, rows] = await Promise.all([
    prisma.inventoryTransaction.count({ where: { variantId } }),
    prisma.inventoryTransaction.findMany({
      where: { variantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
    }),
  ]);

  return {
    variant: { id: variant.id, sku: variant.sku, productName: variant.product.name, stockQuantity: variant.stockQuantity },
    items: rows.map((r) => ({
      id: r.id,
      change: r.quantityChange,
      stockAfter: r.stockAfter,
      reason: r.reason,
      note: r.note,
      orderId: r.orderId,
      createdAt: r.createdAt,
      createdBy: r.createdBy ? { id: r.createdBy.id, name: [r.createdBy.firstName, r.createdBy.lastName].filter(Boolean).join(' ') } : null,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
