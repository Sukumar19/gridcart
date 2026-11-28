import type { Express } from 'express';
import request from 'supertest';
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

// A photo row without a real file, for tests that only care about the database side.
export async function createImageRow(productId: string, opts: { primary?: boolean; sortOrder?: number } = {}) {
  const n = ++counter;
  return prisma.productImage.create({
    data: {
      productId,
      url: `/media/test/${n}.webp`,
      publicId: `test/${n}.webp`,
      isPrimary: opts.primary ?? false,
      sortOrder: opts.sortOrder ?? n,
    },
  });
}

const ORIGIN = 'http://localhost:3000';

// A signed-in API client: every request carries the session cookie and a trusted Origin, like the real frontend.
export async function signInAs(app: Express, email: string) {
  const login = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: TEST_PASSWORD });
  const cookies = (login.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  if (login.status !== 200 || !cookie) throw new Error(`Test sign-in failed for ${email}: ${login.status}`);

  const withAuth = (req: request.Test) => req.set('Cookie', cookie).set('Origin', ORIGIN);
  return {
    get: (url: string) => withAuth(request(app).get(url)),
    post: (url: string) => withAuth(request(app).post(url)),
    put: (url: string) => withAuth(request(app).put(url)),
    patch: (url: string) => withAuth(request(app).patch(url)),
    delete: (url: string) => withAuth(request(app).delete(url)),
  };
}

export type Api = Awaited<ReturnType<typeof signInAs>>;

// An order with one line for the given variant, used to prove that sold products and variants are protected.
export async function createOrderFor(productId: string, variantId: string, opts: { userId?: string; paid?: boolean } = {}) {
  const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId }, include: { product: true } });
  return prisma.order.create({
    data: {
      userId: opts.userId ?? null,
      paymentStatus: opts.paid ? 'PAID' : 'PENDING',
      customerEmail: 'buyer@example.com',
      customerPhone: '+919999999999',
      shippingAddress: { line1: '1 Test Street' },
      subtotal: variant.price,
      totalAmount: variant.price,
      items: {
        create: {
          productId,
          variantId,
          productName: variant.product.name,
          sku: variant.sku,
          unitPrice: variant.price,
          quantity: 1,
          lineTotal: variant.price,
        },
      },
    },
  });
}
