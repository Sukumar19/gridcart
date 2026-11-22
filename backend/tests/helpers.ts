import { hashPassword } from '../src/lib/password';
import { prisma } from '../src/lib/prisma';

export const TEST_PASSWORD = 'Sup3r-secret-pass';

// Safe because tests/setup-env.ts guarantees we are connected to the test database.
export async function resetDatabase() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users", "store_settings", "products", "categories" RESTART IDENTITY CASCADE');
}

let counter = 0;

export async function createCategory(slug: string, name: string, parentSlug?: string) {
  const parent = parentSlug ? await prisma.category.findUniqueOrThrow({ where: { slug: parentSlug } }) : null;
  return prisma.category.create({ data: { slug, name, parentId: parent?.id ?? null, sortOrder: ++counter } });
}

export async function createCatalogGroups() {
  await createCategory('type', 'Type');
  await createCategory('occasion', 'Occasion');
  await createCategory('recipient', 'Recipient');
}

interface VariantSpec {
  price?: number;
  compareAt?: number | null;
  stock?: number;
  track?: boolean;
  color?: string | null;
  size?: string | null;
  active?: boolean;
  lowStockThreshold?: number;
}

export async function createProduct(
  spec: {
    name: string;
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    categories?: string[];
    variants?: VariantSpec[];
    personalised?: boolean;
    featured?: boolean;
    createdAt?: Date;
    images?: number;
  },
) {
  const n = ++counter;
  const slug = `${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${n}`;
  const variants = spec.variants ?? [{}];
  const categories = spec.categories ?? [];
  const categoryRows = await prisma.category.findMany({ where: { slug: { in: categories } } });

  return prisma.product.create({
    data: {
      name: spec.name,
      slug,
      status: spec.status ?? 'ACTIVE',
      isCustomizable: spec.personalised ?? false,
      isFeatured: spec.featured ?? false,
      ...(spec.createdAt ? { createdAt: spec.createdAt } : {}),
      categories: { create: categoryRows.map((c) => ({ categoryId: c.id })) },
      variants: {
        create: variants.map((v, i) => ({
          sku: `SKU-${n}-${i}`,
          price: (v.price ?? 100).toFixed(2),
          compareAtPrice: v.compareAt != null ? v.compareAt.toFixed(2) : null,
          trackInventory: v.track ?? true,
          stockQuantity: v.stock ?? 10,
          lowStockThreshold: v.lowStockThreshold ?? 5,
          color: v.color ?? null,
          size: v.size ?? null,
          isActive: v.active ?? true,
          isDefault: i === 0,
        })),
      },
      images: {
        create: Array.from({ length: spec.images ?? 0 }, (_, i) => ({
          url: `/media/${slug}/${i}.webp`,
          publicId: `${slug}/${i}.webp`,
          isPrimary: i === 0,
          sortOrder: i,
          width: 800,
          height: 1000,
        })),
      },
    },
  });
}

export async function createUser(overrides: { email?: string; role?: 'CUSTOMER' | 'ADMIN'; isActive?: boolean } = {}) {
  return prisma.user.create({
    data: {
      firstName: 'Test',
      email: overrides.email ?? 'user@example.com',
      passwordHash: await hashPassword(TEST_PASSWORD),
      role: overrides.role ?? 'CUSTOMER',
      isActive: overrides.isActive ?? true,
    },
  });
}

export async function closeDatabase() {
  await prisma.$disconnect();
}
