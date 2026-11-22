import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { publicUrl } from '../lib/storage';
import { discountPercent, money } from '../utils/money';
import { HttpError } from '../utils/http-error';
import type { ProductListQuery } from '../validators/catalog.validators';

const GROUP_SLUGS = ['type', 'occasion', 'recipient'] as const;

const cardInclude = {
  images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1 },
  variants: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { price: 'asc' }] },
} satisfies Prisma.ProductInclude;

type CardProduct = Prisma.ProductGetPayload<{ include: typeof cardInclude }>;
type ImageRow = { id: string; url: string; altText: string | null; width: number | null; height: number | null };
type VariantRow = CardProduct['variants'][number];

const isInStock = (v: VariantRow) => !v.trackInventory || v.stockQuantity > 0;

function imageDto(img: ImageRow, fallbackAlt: string) {
  return { id: img.id, url: publicUrl(img.url), alt: img.altText ?? fallbackAlt, width: img.width, height: img.height };
}

function toCard(p: CardProduct) {
  const cheapest = [...p.variants].sort((a, b) => a.price.comparedTo(b.price))[0]!;
  const highest = p.variants.reduce((max, v) => (v.price.greaterThan(max) ? v.price : max), cheapest.price);
  const compareAt = cheapest.compareAtPrice && cheapest.compareAtPrice.greaterThan(cheapest.price) ? cheapest.compareAtPrice : null;

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    isCustomizable: p.isCustomizable,
    isFeatured: p.isFeatured,
    price: money(cheapest.price),
    priceVaries: highest.greaterThan(cheapest.price),
    compareAtPrice: compareAt ? money(compareAt) : null,
    discountPercent: discountPercent(cheapest.price, cheapest.compareAtPrice),
    inStock: p.variants.some(isInStock),
    image: p.images[0] ? imageDto(p.images[0], p.name) : null,
  };
}

export async function listCategories() {
  const rows = await prisma.category.findMany({
    where: { isActive: true, parent: { isActive: true } },
    include: {
      parent: { select: { slug: true, name: true, sortOrder: true } },
      _count: { select: { products: { where: { product: { status: 'ACTIVE' } } } } },
    },
    orderBy: { sortOrder: 'asc' },
  });

  const groups = new Map<string, { slug: string; name: string; sortOrder: number; categories: unknown[] }>();
  for (const row of rows) {
    if (!row.parent || row._count.products === 0) continue;
    const group =
      groups.get(row.parent.slug) ??
      { slug: row.parent.slug, name: row.parent.name, sortOrder: row.parent.sortOrder, categories: [] };
    group.categories.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      imageUrl: row.imageUrl ? publicUrl(row.imageUrl) : null,
      productCount: row._count.products,
    });
    groups.set(row.parent.slug, group);
  }

  return {
    groups: [...groups.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ sortOrder: _sortOrder, ...group }) => group),
  };
}

function buildWhere(f: ProductListQuery, ids?: string[]): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [];

  for (const group of GROUP_SLUGS) {
    const slugs = f[group];
    if (slugs?.length) {
      and.push({ categories: { some: { category: { slug: { in: slugs }, parent: { slug: group } } } } });
    }
  }
  if (f.personalised !== undefined) and.push({ isCustomizable: f.personalised });

  const variant: Prisma.ProductVariantWhereInput = { isActive: true };
  if (f.minPrice !== undefined || f.maxPrice !== undefined) variant.price = { gte: f.minPrice, lte: f.maxPrice };
  if (f.inStock) variant.OR = [{ trackInventory: false }, { stockQuantity: { gt: 0 } }];
  and.push({ variants: { some: variant } });

  if (ids) and.push({ id: { in: ids } });
  return { status: 'ACTIVE', AND: and };
}

// Substring match first, then typo-tolerant trigram match (pg_trgm), best matches first.
async function searchIds(q: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id
    FROM products
    WHERE status = 'ACTIVE'
      AND (position(lower(${q}) in lower(name)) > 0 OR word_similarity(${q}, name) >= 0.4)
    ORDER BY (position(lower(${q}) in lower(name)) > 0) DESC, word_similarity(${q}, name) DESC
    LIMIT 500`;
  return rows.map((r) => r.id);
}

// Fine for a catalogue of up to a few hundred products: filter and sort in memory, then load only one page of details.
export async function listProducts(query: ProductListQuery) {
  const rank = query.q ? await searchIds(query.q) : undefined;
  const sort = query.sort === 'relevance' && !rank ? 'newest' : (query.sort ?? (rank ? 'relevance' : 'newest'));

  const candidates = await prisma.product.findMany({
    where: buildWhere(query, rank),
    select: { id: true, createdAt: true, isFeatured: true, variants: { where: { isActive: true }, select: { price: true } } },
  });

  const rankOf = new Map(rank?.map((id, index) => [id, index]));
  const minPrice = (c: (typeof candidates)[number]) => Math.min(...c.variants.map((v) => v.price.toNumber()));
  const newestFirst = (a: (typeof candidates)[number], b: (typeof candidates)[number]) =>
    b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);

  candidates.sort((a, b) => {
    switch (sort) {
      case 'relevance':
        return (rankOf.get(a.id) ?? 0) - (rankOf.get(b.id) ?? 0);
      case 'featured':
        return Number(b.isFeatured) - Number(a.isFeatured) || newestFirst(a, b);
      case 'price_asc':
        return minPrice(a) - minPrice(b) || newestFirst(a, b);
      case 'price_desc':
        return minPrice(b) - minPrice(a) || newestFirst(a, b);
      default:
        return newestFirst(a, b);
    }
  });

  const total = candidates.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const pageIds = candidates.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map((c) => c.id);

  const rows = await prisma.product.findMany({ where: { id: { in: pageIds } }, include: cardInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = pageIds.flatMap((id) => (byId.has(id) ? [toCard(byId.get(id)!)] : []));

  return { items, page: query.page, pageSize: query.pageSize, total, totalPages, sort };
}

export async function getProductBySlug(slug: string) {
  const product = await prisma.product.findFirst({
    where: { slug, status: 'ACTIVE', variants: { some: { isActive: true } } },
    include: {
      images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
      variants: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { price: 'asc' }] },
      categories: { include: { category: { include: { parent: { select: { slug: true } } } } } },
    },
  });
  if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');

  const typeIds = product.categories.filter((c) => c.category.parent?.slug === 'type').map((c) => c.categoryId);
  const related = typeIds.length
    ? await prisma.product.findMany({
        where: {
          status: 'ACTIVE',
          id: { not: product.id },
          categories: { some: { categoryId: { in: typeIds } } },
          variants: { some: { isActive: true } },
        },
        include: cardInclude,
        orderBy: { createdAt: 'desc' },
        take: 4,
      })
    : [];

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    isCustomizable: product.isCustomizable,
    maxCustomImages: product.isCustomizable ? product.maxCustomImages : null,
    customizationNote: product.isCustomizable ? product.customizationNote : null,
    categories: product.categories.map((c) => ({
      slug: c.category.slug,
      name: c.category.name,
      group: c.category.parent?.slug ?? null,
    })),
    images: product.images.map((img) => ({ ...imageDto(img, product.name), variantId: img.variantId, isPrimary: img.isPrimary })),
    variants: product.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      color: v.color,
      colorHex: v.colorHex,
      size: v.size,
      price: money(v.price),
      compareAtPrice: v.compareAtPrice && v.compareAtPrice.greaterThan(v.price) ? money(v.compareAtPrice) : null,
      discountPercent: discountPercent(v.price, v.compareAtPrice),
      inStock: isInStock(v),
      madeToOrder: !v.trackInventory,
      stockLeft: v.trackInventory && v.stockQuantity > 0 && v.stockQuantity <= v.lowStockThreshold ? v.stockQuantity : null,
      isDefault: v.isDefault,
    })),
    related: related.map(toCard),
  };
}
