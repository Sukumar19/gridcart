import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  closeDatabase,
  createCatalogGroups,
  createCategory,
  createImageRow,
  createOrderFor,
  createProduct,
  createUser,
  resetDatabase,
  signInAs,
  type Api,
} from './helpers';

const ORIGIN = 'http://localhost:3000';
const UNKNOWN_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

let app: ReturnType<typeof createApp>;
let api: Api;

beforeEach(async () => {
  app = createApp();
  await resetDatabase();
  await createCatalogGroups();
  await createCategory('lamps', 'Lamps', 'type');
  await createCategory('keychains', 'Keychains', 'type');
  await createCategory('birthday', 'Birthday', 'occasion');
  await createUser({ email: 'admin@example.com', role: 'ADMIN' });
  api = await signInAs(app, 'admin@example.com');
});

afterAll(closeDatabase);

const create = async (body: object) => {
  const res = await api.post('/api/admin/products').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.product;
};

const categoryId = async (slug: string) => (await prisma.category.findUniqueOrThrow({ where: { slug } })).id;

// A product that satisfies every publish rule, so a test can focus on one rule at a time.
const createReady = async (name = 'Heart Lamp') => {
  const product = await create({ name, gstRate: 18, variant: { price: 499, stockQuantity: 5 } });
  await createImageRow(product.id, { primary: true });
  return product;
};

describe('admin access control', () => {
  const routes: [method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string][] = [
    ['get', '/api/admin/products'],
    ['post', '/api/admin/products'],
    ['patch', `/api/admin/products/${UNKNOWN_ID}`],
    ['delete', `/api/admin/products/${UNKNOWN_ID}`],
    ['post', `/api/admin/products/${UNKNOWN_ID}/images`],
    ['get', '/api/admin/categories'],
    ['post', '/api/admin/categories'],
    ['get', '/api/admin/inventory'],
    ['post', `/api/admin/variants/${UNKNOWN_ID}/stock`],
    ['get', '/api/admin/customers'],
    ['patch', `/api/admin/customers/${UNKNOWN_ID}`],
    ['get', '/api/admin/settings'],
    ['put', '/api/admin/settings/shipping'],
  ];

  it.each(routes)('%s %s requires a signed-in user', async (method, url) => {
    const res = await request(app)[method](url).set('Origin', ORIGIN);
    expect(res.status).toBe(401);
  });

  it.each(routes)('%s %s refuses a customer account', async (method, url) => {
    await createUser({ email: 'shopper@example.com' });
    const shopper = await signInAs(app, 'shopper@example.com');
    const res = await shopper[method](url);
    expect(res.status).toBe(403);
  });

  it('refuses writes from an untrusted origin even with a valid session', async () => {
    const res = await api.post('/api/admin/products').set('Origin', 'https://evil.example').send({ name: 'X' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
  });

  it('marks admin responses as not cacheable', async () => {
    const res = await api.get('/api/admin/products');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('POST /api/admin/products', () => {
  it('creates a draft with a placeholder variant and explains what is missing', async () => {
    const product = await create({ name: 'Heart Lamp' });

    expect(product).toMatchObject({ name: 'Heart Lamp', slug: 'heart-lamp', status: 'DRAFT', isFeatured: false, isCustomizable: false });
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0]).toMatchObject({ sku: 'GC-0001', price: '0.00', isDefault: true, isActive: true });
    expect(product.readiness.canPublish).toBe(false);
    expect(product.readiness.issues.map((i: { code: string }) => i.code)).toEqual(['ZERO_PRICE', 'NO_IMAGE', 'NO_GST_RATE']);
    expect(product.readiness.warnings.map((w: { code: string }) => w.code)).toEqual(['NO_TYPE_CATEGORY']);
  });

  it('stores details, categories and the first variant', async () => {
    const product = await create({
      name: 'Photo Lamp',
      description: 'A lamp with your photo',
      isCustomizable: true,
      maxCustomImages: 3,
      customizationNote: 'Send a clear photo',
      hsnCode: '9405',
      gstRate: 18,
      categoryIds: [await categoryId('lamps'), await categoryId('birthday')],
      variant: { price: 799, compareAtPrice: 999, color: 'Warm', stockQuantity: 12, lowStockThreshold: 3 },
    });

    expect(product).toMatchObject({ isCustomizable: true, maxCustomImages: 3, hsnCode: '9405', gstRate: '18.00' });
    expect(product.categories.map((c: { slug: string }) => c.slug).sort()).toEqual(['birthday', 'lamps']);
    expect(product.variants[0]).toMatchObject({ price: '799.00', compareAtPrice: '999.00', color: 'Warm', stockQuantity: 12, lowStockThreshold: 3 });
    expect(product.readiness.warnings).toEqual([]);

    const ledger = await prisma.inventoryTransaction.findMany({ where: { variantId: product.variants[0].id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ quantityChange: 12, stockAfter: 12, reason: 'RESTOCK' });
  });

  it('gives each product a unique link and numbers SKUs in sequence', async () => {
    const first = await create({ name: 'Heart Lamp' });
    const second = await create({ name: 'Heart Lamp' });

    expect([first.slug, second.slug]).toEqual(['heart-lamp', 'heart-lamp-2']);
    expect([first.variants[0].sku, second.variants[0].sku]).toEqual(['GC-0001', 'GC-0002']);
  });

  it('refuses a link that another product already uses', async () => {
    await create({ name: 'Heart Lamp' });
    const res = await api.post('/api/admin/products').send({ name: 'Another', slug: 'heart-lamp' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLUG_TAKEN');
  });

  it('refuses group-level and unknown categories', async () => {
    const group = await api.post('/api/admin/products').send({ name: 'A', categoryIds: [await categoryId('type')] });
    expect(group.status).toBe(400);
    expect(group.body.error.code).toBe('CATEGORY_IS_GROUP');

    const unknown = await api.post('/api/admin/products').send({ name: 'B', categoryIds: [UNKNOWN_ID] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('UNKNOWN_CATEGORY');
    expect(await prisma.product.count()).toBe(0);
  });

  it('validates input and reports which fields are wrong', async () => {
    const res = await api.post('/api/admin/products').send({ name: '  ', hsnCode: '12', gstRate: 150, status: 'ACTIVE' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'hsnCode', 'gstRate']));
    expect(await prisma.product.count()).toBe(0);
  });

  it('does not allow creating a product that is already live', async () => {
    const res = await api.post('/api/admin/products').send({ name: 'Sneaky', status: 'ACTIVE' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/products', () => {
  it('lists every status with counts, price range, stock and readiness', async () => {
    await createProduct({ name: 'Live Lamp', status: 'ACTIVE', images: 1, variants: [{ price: 300, stock: 2, lowStockThreshold: 5 }, { price: 500, color: 'Red', stock: 40 }] });
    await createProduct({ name: 'Draft Frame', status: 'DRAFT' });
    await createProduct({ name: 'Old Keychain', status: 'ARCHIVED' });

    const res = await api.get('/api/admin/products');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.statusCounts).toEqual({ DRAFT: 1, ACTIVE: 1, ARCHIVED: 1 });

    const live = res.body.items.find((p: { name: string }) => p.name === 'Live Lamp');
    expect(live).toMatchObject({ priceMin: '300.00', priceMax: '500.00', variantCount: 2, stockTotal: 42, lowStock: true, imageCount: 1 });
    expect(live.image).toMatch(/^http:\/\/api\.test\/media\//);
  });

  it('filters by status, search text (name or SKU) and incompleteness', async () => {
    await createProduct({ name: 'Heart Lamp', status: 'DRAFT', images: 1 });
    await createProduct({ name: 'Moon Lamp', status: 'ACTIVE' });
    const frame = await createProduct({ name: 'Photo Frame', status: 'ACTIVE', images: 1 });
    await prisma.product.update({ where: { id: frame.id }, data: { gstRate: '12' } });
    const sku = (await prisma.productVariant.findFirstOrThrow({ where: { productId: frame.id } })).sku;

    const names = async (query: string) => (await api.get(`/api/admin/products?${query}`)).body.items.map((p: { name: string }) => p.name).sort();

    expect(await names('status=ACTIVE')).toEqual(['Moon Lamp', 'Photo Frame']);
    expect(await names('q=lamp')).toEqual(['Heart Lamp', 'Moon Lamp']);
    expect(await names(`q=${sku.toLowerCase()}`)).toEqual(['Photo Frame']);
    expect(await names('incomplete=false')).toEqual(['Photo Frame']);
    expect(await names('incomplete=true')).toEqual(['Heart Lamp', 'Moon Lamp']);
  });

  it('paginates', async () => {
    for (const name of ['A', 'B', 'C']) await createProduct({ name, status: 'DRAFT' });
    const res = await api.get('/api/admin/products?sort=name&pageSize=2&page=2');
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['C']);
    expect(res.body).toMatchObject({ total: 3, totalPages: 2, page: 2 });
  });
});

describe('GET and PATCH /api/admin/products/:id', () => {
  it('returns the full product, including inactive variants', async () => {
    const product = await createProduct({ name: 'Heart Lamp', status: 'DRAFT', variants: [{}, { color: 'Blue', active: false }] });
    const res = await api.get(`/api/admin/products/${product.id}`);

    expect(res.status).toBe(200);
    expect(res.body.product.variants).toHaveLength(2);
    expect(res.body.product.variants.map((v: { isActive: boolean }) => v.isActive)).toEqual([true, false]);
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    expect((await api.get(`/api/admin/products/${UNKNOWN_ID}`)).status).toBe(404);
    expect((await api.get('/api/admin/products/not-an-id')).status).toBe(400);
  });

  it('updates details and clears optional text with an empty value', async () => {
    const product = await create({ name: 'Heart Lamp', description: 'Old text', hsnCode: '9405' });
    const res = await api
      .patch(`/api/admin/products/${product.id}`)
      .send({ name: 'Heart Night Lamp', description: '', hsnCode: null, isFeatured: true, gstRate: 12 });

    expect(res.status).toBe(200);
    expect(res.body.product).toMatchObject({ name: 'Heart Night Lamp', description: null, hsnCode: null, isFeatured: true, gstRate: '12.00' });
    expect(res.body.product.slug).toBe('heart-lamp');
  });

  it('refuses a link used by another product but allows keeping its own', async () => {
    const first = await create({ name: 'Heart Lamp' });
    const second = await create({ name: 'Moon Lamp' });

    expect((await api.patch(`/api/admin/products/${second.id}`).send({ slug: 'heart-lamp' })).status).toBe(409);
    expect((await api.patch(`/api/admin/products/${first.id}`).send({ slug: 'heart-lamp' })).status).toBe(200);
  });

  it('refuses unknown fields so status cannot be changed through a plain edit', async () => {
    const product = await create({ name: 'Heart Lamp' });
    const res = await api.patch(`/api/admin/products/${product.id}`).send({ status: 'ACTIVE' });
    expect(res.status).toBe(400);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('DRAFT');
  });

  it('refuses an edit that would leave a live product incomplete and keeps the old value', async () => {
    const product = await createReady();
    await api.post(`/api/admin/products/${product.id}/publish`);

    const res = await api.patch(`/api/admin/products/${product.id}`).send({ gstRate: null });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LIVE_PRODUCT_INCOMPLETE');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).gstRate?.toNumber()).toBe(18);
  });
});

describe('PUT /api/admin/products/:id/categories', () => {
  it('replaces the category set', async () => {
    const product = await create({ name: 'Heart Lamp', categoryIds: [await categoryId('lamps')] });
    const res = await api.put(`/api/admin/products/${product.id}/categories`).send({ categoryIds: [await categoryId('birthday'), await categoryId('keychains')] });

    expect(res.status).toBe(200);
    expect(res.body.product.categories.map((c: { slug: string }) => c.slug).sort()).toEqual(['birthday', 'keychains']);
  });

  it('can remove all categories and rejects groups', async () => {
    const product = await create({ name: 'Heart Lamp', categoryIds: [await categoryId('lamps')] });
    expect((await api.put(`/api/admin/products/${product.id}/categories`).send({ categoryIds: [await categoryId('type')] })).status).toBe(400);
    const cleared = await api.put(`/api/admin/products/${product.id}/categories`).send({ categoryIds: [] });
    expect(cleared.body.product.categories).toEqual([]);
  });
});

describe('publishing', () => {
  it('blocks publishing until price, photo and GST rate are set, and says why', async () => {
    const product = await create({ name: 'Heart Lamp' });
    const res = await api.post(`/api/admin/products/${product.id}/publish`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_PUBLISHABLE');
    expect(res.body.error.details.map((i: { code: string }) => i.code)).toEqual(['ZERO_PRICE', 'NO_IMAGE', 'NO_GST_RATE']);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('DRAFT');
  });

  it('does not count an inactive variant as sellable', async () => {
    const product = await createReady();
    await prisma.productVariant.updateMany({ where: { productId: product.id }, data: { isActive: false } });
    const res = await api.post(`/api/admin/products/${product.id}/publish`);
    expect(res.body.error.details.map((i: { code: string }) => i.code)).toContain('NO_ACTIVE_VARIANT');
  });

  it('allows a GST rate of 0 for exempt goods', async () => {
    const product = await createReady();
    await api.patch(`/api/admin/products/${product.id}`).send({ gstRate: 0 });
    expect((await api.post(`/api/admin/products/${product.id}/publish`)).status).toBe(200);
  });

  it('puts a ready product on the public storefront and takes it off again', async () => {
    const product = await createReady();
    expect((await request(app).get(`/api/products/${product.slug}`)).status).toBe(404);

    const live = await api.post(`/api/admin/products/${product.id}/publish`);
    expect(live.status).toBe(200);
    expect(live.body.product.status).toBe('ACTIVE');

    const pub = await request(app).get(`/api/products/${product.slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.product.variants[0].price).toBe('499.00');

    const off = await api.post(`/api/admin/products/${product.id}/unpublish`);
    expect(off.body.product.status).toBe('DRAFT');
    expect((await request(app).get(`/api/products/${product.slug}`)).status).toBe(404);
  });

  it('only allows sensible status changes', async () => {
    const product = await createReady();
    const unpublish = await api.post(`/api/admin/products/${product.id}/unpublish`);
    expect(unpublish.status).toBe(409);
    expect(unpublish.body.error.code).toBe('INVALID_STATE');

    await api.post(`/api/admin/products/${product.id}/archive`);
    expect((await api.post(`/api/admin/products/${product.id}/publish`)).status).toBe(409);

    const restored = await api.post(`/api/admin/products/${product.id}/restore`);
    expect(restored.body.product.status).toBe('DRAFT');
    expect((await api.post(`/api/admin/products/${product.id}/restore`)).status).toBe(409);
  });

  it('hides an archived product from the storefront', async () => {
    const product = await createReady();
    await api.post(`/api/admin/products/${product.id}/publish`);
    await api.post(`/api/admin/products/${product.id}/archive`);
    expect((await request(app).get(`/api/products/${product.slug}`)).status).toBe(404);
  });
});

describe('DELETE /api/admin/products/:id', () => {
  it('deletes a product that was never ordered, with its variants and stock history', async () => {
    const product = await create({ name: 'Mistake', variant: { price: 100, stockQuantity: 4 } });
    const res = await api.delete(`/api/admin/products/${product.id}`);

    expect(res.status).toBe(204);
    expect(await prisma.product.count()).toBe(0);
    expect(await prisma.productVariant.count()).toBe(0);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });

  it('refuses to delete a product with order history and suggests archiving', async () => {
    const product = await createProduct({ name: 'Sold Lamp' });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await createOrderFor(product.id, variant.id);

    const res = await api.delete(`/api/admin/products/${product.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_ORDERS');
    expect(await prisma.product.count()).toBe(1);

    expect((await api.post(`/api/admin/products/${product.id}/archive`)).status).toBe(200);
  });

  it('returns 404 for an unknown product', async () => {
    expect((await api.delete(`/api/admin/products/${UNKNOWN_ID}`)).status).toBe(404);
  });
});

describe('variants', () => {
  const variantUrl = (productId: string, variantId = '') => `/api/admin/products/${productId}/variants${variantId ? `/${variantId}` : ''}`;

  it('adds a variant with an automatic SKU that is not the default', async () => {
    const product = await create({ name: 'Heart Lamp', variant: { price: 400 } });
    const res = await api.post(variantUrl(product.id)).send({ color: 'Pink', colorHex: '#FF69B4', size: 'Large', price: '450.50', stockQuantity: 3 });

    expect(res.status).toBe(201);
    expect(res.body.variant).toMatchObject({ sku: 'GC-0002', color: 'Pink', colorHex: '#FF69B4', price: '450.50', stockQuantity: 3, isDefault: false });
  });

  it('moves the default flag when asked, keeping exactly one default', async () => {
    const product = await create({ name: 'Heart Lamp', variant: { price: 400 } });
    const added = await api.post(variantUrl(product.id)).send({ color: 'Pink', price: 450, isDefault: true });
    expect(added.body.variant.isDefault).toBe(true);

    const variants = await prisma.productVariant.findMany({ where: { productId: product.id } });
    expect(variants.filter((v) => v.isDefault)).toHaveLength(1);
    expect(variants.find((v) => v.isDefault)?.id).toBe(added.body.variant.id);
  });

  it('refuses a duplicate SKU and a duplicate colour and size', async () => {
    const product = await create({ name: 'Heart Lamp', variant: { price: 400, color: 'Pink', size: 'Small', sku: 'LAMP-1' } });

    const sku = await api.post(variantUrl(product.id)).send({ price: 400, color: 'Blue', sku: 'lamp-1' });
    expect(sku.status).toBe(409);
    expect(sku.body.error.code).toBe('SKU_TAKEN');

    const combo = await api.post(variantUrl(product.id)).send({ price: 400, color: 'PINK', size: 'small' });
    expect(combo.status).toBe(409);
    expect(combo.body.error.code).toBe('VARIANT_EXISTS');
  });

  it('refuses an old price below the selling price', async () => {
    const product = await create({ name: 'Heart Lamp' });
    const res = await api.post(variantUrl(product.id)).send({ color: 'Blue', price: 500, compareAtPrice: 400 });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('compareAtPrice');
  });

  it('edits a variant and checks the old price against the stored selling price', async () => {
    const product = await create({ name: 'Heart Lamp', variant: { price: 400, compareAtPrice: 500 } });
    const variantId = product.variants[0].id;

    const ok = await api.patch(variantUrl(product.id, variantId)).send({ price: 450, lowStockThreshold: 2 });
    expect(ok.body.variant).toMatchObject({ price: '450.00', compareAtPrice: '500.00', lowStockThreshold: 2 });

    const bad = await api.patch(variantUrl(product.id, variantId)).send({ price: 600 });
    expect(bad.status).toBe(400);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).price.toFixed(2)).toBe('450.00');

    const cleared = await api.patch(variantUrl(product.id, variantId)).send({ compareAtPrice: null, price: 600 });
    expect(cleared.body.variant).toMatchObject({ price: '600.00', compareAtPrice: null });
  });

  it('cannot change stock through a variant edit', async () => {
    const product = await create({ name: 'Heart Lamp', variant: { price: 400, stockQuantity: 5 } });
    const res = await api.patch(variantUrl(product.id, product.variants[0].id)).send({ stockQuantity: 999 });
    expect(res.status).toBe(400);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stockQuantity).toBe(5);
  });

  it('does not find a variant through the wrong product', async () => {
    const a = await create({ name: 'A Lamp' });
    const b = await create({ name: 'B Lamp' });
    expect((await api.patch(variantUrl(a.id, b.variants[0].id)).send({ price: 10 })).status).toBe(404);
  });

  it('keeps one default: cannot unset it directly, and deactivating it promotes another', async () => {
    const product = await create({ name: 'Heart Lamp', variant: { price: 400 } });
    const first = product.variants[0].id;
    const second = (await api.post(variantUrl(product.id)).send({ color: 'Blue', price: 400 })).body.variant.id;

    const unset = await api.patch(variantUrl(product.id, first)).send({ isDefault: false });
    expect(unset.status).toBe(400);
    expect(unset.body.error.code).toBe('DEFAULT_REQUIRED');

    const off = await api.patch(variantUrl(product.id, first)).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.variant).toMatchObject({ isActive: false, isDefault: false });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: second } })).isDefault).toBe(true);
  });

  it('does not let a live product lose its last active variant or get a zero price', async () => {
    const product = await createReady();
    await api.post(`/api/admin/products/${product.id}/publish`);
    const variantId = product.variants[0].id;

    const zero = await api.patch(variantUrl(product.id, variantId)).send({ price: 0 });
    expect(zero.status).toBe(409);
    expect(zero.body.error.code).toBe('LIVE_PRODUCT_INCOMPLETE');

    const off = await api.patch(variantUrl(product.id, variantId)).send({ isActive: false });
    expect(off.status).toBe(409);

    const stored = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(stored.price.toFixed(2)).toBe('499.00');
    expect(stored.isActive).toBe(true);
  });

  it('deletes a spare variant, promotes a new default, and refuses to delete the last one', async () => {
    const product = await create({ name: 'Heart Lamp', variant: { price: 400 } });
    const first = product.variants[0].id;
    const second = (await api.post(variantUrl(product.id)).send({ color: 'Blue', price: 400, stockQuantity: 2 })).body.variant.id;

    const last = await api.delete(variantUrl(product.id, first));
    expect(last.status).toBe(204);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: second } })).isDefault).toBe(true);

    const only = await api.delete(variantUrl(product.id, second));
    expect(only.status).toBe(409);
    expect(only.body.error.code).toBe('LAST_VARIANT');
  });

  it('refuses to delete a variant that has been ordered', async () => {
    const product = await createProduct({ name: 'Sold Lamp', variants: [{}, { color: 'Blue' }] });
    const [first] = await prisma.productVariant.findMany({ where: { productId: product.id }, orderBy: { sku: 'asc' } });
    await createOrderFor(product.id, first!.id);

    const res = await api.delete(variantUrl(product.id, first!.id));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_ORDERS');
  });
});
