import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/http-error';
import type { VariantCreateInput, VariantUpdateInput } from '../../validators/admin.validators';
import { variantDto } from './dto';
import { assertStillPublishable } from './readiness';
import { isUniqueViolation, notFound, type Db } from './shared';

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

// Matches the seed format: GC-0001, GC-0002...
export async function nextSku(db: Db): Promise<string> {
  const rows = await db.$queryRaw<{ n: number | null }[]>`
    SELECT MAX(substring(sku from 4)::int) AS n FROM product_variants WHERE sku ~ '^GC-[0-9]{1,9}$'`;
  return `GC-${String((rows[0]?.n ?? 0) + 1).padStart(4, '0')}`;
}

async function assertUnique(
  db: Db,
  productId: string,
  candidate: { sku: string; color: string | null; size: string | null },
  excludeId?: string,
) {
  const skuOwner = await db.productVariant.findUnique({ where: { sku: candidate.sku }, select: { id: true } });
  if (skuOwner && skuOwner.id !== excludeId) {
    throw new HttpError(409, 'SKU_TAKEN', `SKU ${candidate.sku} is already used by another variant`);
  }

  const siblings = await db.productVariant.findMany({ where: { productId }, select: { id: true, color: true, size: true } });
  if (siblings.some((s) => s.id !== excludeId && same(s.color, candidate.color) && same(s.size, candidate.size))) {
    throw new HttpError(409, 'VARIANT_EXISTS', 'This product already has a variant with the same colour and size');
  }
}

export async function createVariantRow(db: Db, productId: string, input: VariantCreateInput, adminId: string | null, makeDefault: boolean) {
  const sku = input.sku ?? (await nextSku(db));
  const color = input.color ?? null;
  const size = input.size ?? null;
  await assertUnique(db, productId, { sku, color, size });

  const track = input.trackInventory ?? true;
  const stock = track ? (input.stockQuantity ?? 0) : 0;

  if (makeDefault) await db.productVariant.updateMany({ where: { productId, isDefault: true }, data: { isDefault: false } });

  const variant = await db.productVariant.create({
    data: {
      productId,
      sku,
      color,
      colorHex: input.colorHex ?? null,
      size,
      price: input.price,
      compareAtPrice: input.compareAtPrice ?? null,
      trackInventory: track,
      stockQuantity: stock,
      lowStockThreshold: input.lowStockThreshold ?? 5,
      isDefault: makeDefault,
      isActive: input.isActive ?? true,
    },
  });

  if (stock > 0) {
    await db.inventoryTransaction.create({
      data: { variantId: variant.id, quantityChange: stock, stockAfter: stock, reason: 'RESTOCK', createdById: adminId, note: 'Initial stock' },
    });
  }
  return variant;
}

export async function addVariant(productId: string, input: VariantCreateInput, adminId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true } });
      if (!product) throw notFound('Product');

      const hasDefault = (await tx.productVariant.count({ where: { productId, isDefault: true } })) > 0;
      const makeDefault = (input.isDefault === true || !hasDefault) && input.isActive !== false;
      const variant = await createVariantRow(tx, productId, input, adminId, makeDefault);
      await assertStillPublishable(tx, productId);
      return { variant: variantDto(variant) };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'VARIANT_EXISTS', 'A variant with the same SKU or colour and size already exists');
    throw err;
  }
}

export async function editVariant(productId: string, variantId: string, input: VariantUpdateInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.productVariant.findFirst({ where: { id: variantId, productId } });
      if (!current) throw notFound('Variant');

      const price = input.price ?? current.price.toFixed(2);
      const compareAt = input.compareAtPrice !== undefined ? input.compareAtPrice : (current.compareAtPrice?.toFixed(2) ?? null);
      if (compareAt !== null && Number(compareAt) < Number(price)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Please check the highlighted fields', [
          { field: 'compareAtPrice', message: 'The old price must not be lower than the selling price' },
        ]);
      }

      await assertUnique(
        tx,
        productId,
        {
          sku: input.sku ?? current.sku,
          color: input.color !== undefined ? input.color : current.color,
          size: input.size !== undefined ? input.size : current.size,
        },
        variantId,
      );

      const nextActive = input.isActive ?? current.isActive;
      if (input.isDefault === false && current.isDefault) {
        throw new HttpError(400, 'DEFAULT_REQUIRED', 'A product needs a default variant. Make another variant the default instead.');
      }
      if (input.isDefault === true && !nextActive) {
        throw new HttpError(400, 'DEFAULT_MUST_BE_ACTIVE', 'The default variant must be active');
      }

      const nowDefault = input.isDefault === true || (current.isDefault && nextActive);
      if (nowDefault && !current.isDefault) {
        await tx.productVariant.updateMany({ where: { productId, isDefault: true }, data: { isDefault: false } });
      }

      const { isDefault: _ignored, ...fields } = input;
      const updated = await tx.productVariant.update({ where: { id: variantId }, data: { ...fields, isDefault: nowDefault } });

      if (current.isDefault && !nowDefault) {
        const successor = await tx.productVariant.findFirst({
          where: { productId, isActive: true, id: { not: variantId } },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (successor) await tx.productVariant.update({ where: { id: successor.id }, data: { isDefault: true } });
      }

      await assertStillPublishable(tx, productId);
      return { variant: variantDto(updated) };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'VARIANT_EXISTS', 'A variant with the same SKU or colour and size already exists');
    throw err;
  }
}

export async function removeVariant(productId: string, variantId: string) {
  await prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.findFirst({ where: { id: variantId, productId } });
    if (!variant) throw notFound('Variant');

    if ((await tx.productVariant.count({ where: { productId } })) === 1) {
      throw new HttpError(409, 'LAST_VARIANT', 'A product needs at least one variant');
    }
    if ((await tx.orderItem.count({ where: { variantId } })) > 0) {
      throw new HttpError(409, 'HAS_ORDERS', 'This variant has been ordered before, so it cannot be deleted. Deactivate it instead.');
    }

    await tx.inventoryTransaction.deleteMany({ where: { variantId } });
    await tx.productVariant.delete({ where: { id: variantId } });

    if (variant.isDefault) {
      const successor = await tx.productVariant.findFirst({
        where: { productId },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      if (successor) await tx.productVariant.update({ where: { id: successor.id }, data: { isDefault: true } });
    }

    await assertStillPublishable(tx, productId);
  });
}
