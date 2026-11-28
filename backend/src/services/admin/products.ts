import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { imageStorage, publicUrl } from '../../lib/storage';
import { HttpError } from '../../utils/http-error';
import { money } from '../../utils/money';
import { slugify } from '../../utils/slug';
import type {
  AdminProductListQuery,
  ProductCreateInput,
  ProductUpdateInput,
} from '../../validators/admin.validators';
import { imageDto, imageOrder, variantDto, variantOrder } from './dto';
import { assertStillPublishable, explainIssues, loadReadiness, publishReadiness } from './readiness';
import { isUniqueViolation, notFound, paginate, uniqueSlug, type Db } from './shared';
import { createVariantRow } from './variants';

const categoryInclude = {
  category: { select: { id: true, slug: true, name: true, parent: { select: { slug: true, name: true } } } },
} satisfies Prisma.ProductCategoryInclude;

const detailInclude = {
  variants: { orderBy: variantOrder },
  images: { orderBy: imageOrder },
  categories: { include: categoryInclude },
} satisfies Prisma.ProductInclude;

type DetailProduct = Prisma.ProductGetPayload<{ include: typeof detailInclude }>;

const categoryDto = (c: DetailProduct['categories'][number]) => ({
  id: c.category.id,
  slug: c.category.slug,
  name: c.category.name,
  group: c.category.parent?.slug ?? null,
});

function readinessOf(p: DetailProduct) {
  return publishReadiness({
    gstRate: p.gstRate,
    variants: p.variants,
    imageCount: p.images.length,
    hasTypeCategory: p.categories.some((c) => c.category.parent?.slug === 'type'),
  });
}

function detailDto(p: DetailProduct) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    status: p.status,
    isFeatured: p.isFeatured,
    isCustomizable: p.isCustomizable,
    maxCustomImages: p.maxCustomImages,
    customizationNote: p.customizationNote,
    hsnCode: p.hsnCode,
    gstRate: p.gstRate ? p.gstRate.toFixed(2) : null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    categories: p.categories.map(categoryDto),
    variants: p.variants.map(variantDto),
    images: p.images.map(imageDto),
    readiness: readinessOf(p),
  };
}

function listDto(p: DetailProduct) {
  const active = p.variants.filter((v) => v.isActive);
  const priced = (active.length ? active : p.variants).map((v) => v.price);
  const tracked = active.filter((v) => v.trackInventory);
  const primary = p.images[0];

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    status: p.status,
    isFeatured: p.isFeatured,
    isCustomizable: p.isCustomizable,
    gstRate: p.gstRate ? p.gstRate.toFixed(2) : null,
    priceMin: priced.length ? money(priced.reduce((a, b) => (b.lessThan(a) ? b : a))) : null,
    priceMax: priced.length ? money(priced.reduce((a, b) => (b.greaterThan(a) ? b : a))) : null,
    variantCount: p.variants.length,
    activeVariantCount: active.length,
    stockTotal: tracked.reduce((sum, v) => sum + v.stockQuantity, 0),
    lowStock: tracked.some((v) => v.stockQuantity <= v.lowStockThreshold),
    imageCount: p.images.length,
    image: primary ? publicUrl(primary.url) : null,
    categories: p.categories.map(categoryDto),
    readiness: readinessOf(p),
    updatedAt: p.updatedAt,
  };
}

export async function listProducts(query: AdminProductListQuery) {
  const where: Prisma.ProductWhereInput = {
    ...(query.status && { status: query.status }),
    ...(query.featured !== undefined && { isFeatured: query.featured }),
    ...(query.personalised !== undefined && { isCustomizable: query.personalised }),
    ...(query.type && { categories: { some: { category: { slug: query.type } } } }),
    ...(query.q && {
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: query.q, mode: 'insensitive' } } } },
      ],
    }),
  };
  const orderBy: Prisma.ProductOrderByWithRelationInput =
    query.sort === 'name' ? { name: 'asc' } : query.sort === 'created' ? { createdAt: 'desc' } : { updatedAt: 'desc' };

  // The catalogue is small, so readiness is computed in memory rather than in SQL.
  const rows = await prisma.product.findMany({ where, orderBy, include: detailInclude });
  const items = rows.map(listDto).filter((p) => query.incomplete === undefined || p.readiness.canPublish !== query.incomplete);

  const counts = await prisma.product.groupBy({ by: ['status'], _count: { _all: true } });
  const byStatus = { DRAFT: 0, ACTIVE: 0, ARCHIVED: 0 };
  for (const c of counts) byStatus[c.status] = c._count._all;

  return { ...paginate(items, query.page, query.pageSize), statusCounts: byStatus };
}

async function loadDetail(db: Db, id: string) {
  const product = await db.product.findUnique({ where: { id }, include: detailInclude });
  if (!product) throw notFound('Product');
  return product;
}

export async function getProduct(id: string) {
  return { product: detailDto(await loadDetail(prisma, id)) };
}

async function assertAssignableCategories(db: Db, ids: string[]) {
  if (ids.length === 0) return;
  const rows = await db.category.findMany({ where: { id: { in: ids } }, select: { id: true, parentId: true } });
  if (rows.length !== new Set(ids).size) throw new HttpError(400, 'UNKNOWN_CATEGORY', 'One of the chosen categories does not exist');
  if (rows.some((r) => r.parentId === null)) {
    throw new HttpError(400, 'CATEGORY_IS_GROUP', 'Choose categories inside Type, Occasion or Recipient, not the group itself');
  }
}

const slugTaken = (db: Db) => async (candidate: string) => (await db.product.count({ where: { slug: candidate } })) > 0;

export async function createProduct(input: ProductCreateInput, adminId: string) {
  try {
    const id = await prisma.$transaction(async (tx) => {
      let slug: string;
      if (input.slug) {
        if (await slugTaken(tx)(input.slug)) throw new HttpError(409, 'SLUG_TAKEN', 'Another product already uses this link');
        slug = input.slug;
      } else {
        slug = await uniqueSlug(slugTaken(tx), slugify(input.name), 'product');
      }

      const categoryIds = [...new Set(input.categoryIds ?? [])];
      await assertAssignableCategories(tx, categoryIds);

      const product = await tx.product.create({
        data: {
          name: input.name,
          slug,
          description: input.description ?? null,
          status: 'DRAFT',
          isFeatured: input.isFeatured ?? false,
          isCustomizable: input.isCustomizable ?? false,
          maxCustomImages: input.maxCustomImages ?? 1,
          customizationNote: input.customizationNote ?? null,
          hsnCode: input.hsnCode ?? null,
          gstRate: input.gstRate ?? null,
          categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
        },
      });

      // Every product keeps at least one variant; without details it starts as a placeholder to be priced later.
      await createVariantRow(tx, product.id, input.variant ?? { price: '0' }, adminId, true);
      return product.id;
    });
    return await getProduct(id);
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'SLUG_TAKEN', 'Another product already uses this link');
    throw err;
  }
}

export async function updateProduct(id: string, input: ProductUpdateInput) {
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id }, select: { id: true } });
      if (!current) throw notFound('Product');

      if (input.slug) {
        const owner = await tx.product.findUnique({ where: { slug: input.slug }, select: { id: true } });
        if (owner && owner.id !== id) throw new HttpError(409, 'SLUG_TAKEN', 'Another product already uses this link');
      }

      await tx.product.update({ where: { id }, data: input });
      await assertStillPublishable(tx, id);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'SLUG_TAKEN', 'Another product already uses this link');
    throw err;
  }
  return getProduct(id);
}

export async function setProductCategories(id: string, categoryIds: string[]) {
  const unique = [...new Set(categoryIds)];
  await prisma.$transaction(async (tx) => {
    if (!(await tx.product.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Product');
    await assertAssignableCategories(tx, unique);
    await tx.productCategory.deleteMany({ where: { productId: id } });
    await tx.productCategory.createMany({ data: unique.map((categoryId) => ({ productId: id, categoryId })) });
    await tx.product.update({ where: { id }, data: { updatedAt: new Date() } });
  });
  return getProduct(id);
}

async function changeStatus(id: string, from: ('DRAFT' | 'ACTIVE' | 'ARCHIVED')[], to: 'DRAFT' | 'ACTIVE' | 'ARCHIVED', action: string) {
  await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id }, select: { status: true } });
    if (!product) throw notFound('Product');
    if (!from.includes(product.status)) {
      throw new HttpError(409, 'INVALID_STATE', `A ${product.status.toLowerCase()} product cannot be ${action}`);
    }

    if (to === 'ACTIVE') {
      const readiness = await loadReadiness(tx, id);
      if (!readiness.canPublish) {
        throw new HttpError(400, 'NOT_PUBLISHABLE', `This product cannot go live yet. ${explainIssues(readiness)}.`, readiness.issues);
      }
    }
    await tx.product.update({ where: { id }, data: { status: to } });
  });
  return getProduct(id);
}

export const publishProduct = (id: string) => changeStatus(id, ['DRAFT'], 'ACTIVE', 'published');
export const unpublishProduct = (id: string) => changeStatus(id, ['ACTIVE'], 'DRAFT', 'unpublished');
export const archiveProduct = (id: string) => changeStatus(id, ['DRAFT', 'ACTIVE'], 'ARCHIVED', 'archived');
export const restoreProduct = (id: string) => changeStatus(id, ['ARCHIVED'], 'DRAFT', 'restored');

// Only for products that were never ordered; anything with order history must be archived to keep invoices and orders intact.
export async function deleteProduct(id: string) {
  const publicIds = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id },
      select: { variants: { select: { id: true } }, images: { select: { publicId: true } } },
    });
    if (!product) throw notFound('Product');

    if ((await tx.orderItem.count({ where: { productId: id } })) > 0) {
      throw new HttpError(409, 'HAS_ORDERS', 'This product has been ordered before, so it cannot be deleted. Archive it instead.');
    }

    await tx.inventoryTransaction.deleteMany({ where: { variantId: { in: product.variants.map((v) => v.id) } } });
    await tx.product.delete({ where: { id } });
    return product.images.map((i) => i.publicId);
  });

  await Promise.all(publicIds.map((publicId) => imageStorage.remove(publicId).catch(() => undefined)));
}
