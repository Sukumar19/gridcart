import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  closeDatabase,
  createCatalogGroups,
  createCategory,
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
let adminId: string;

beforeEach(async () => {
  app = createApp();
  await resetDatabase();
  await createCatalogGroups();
  adminId = (await createUser({ email: 'admin@example.com', role: 'ADMIN' })).id;
  api = await signInAs(app, 'admin@example.com');
});

afterAll(closeDatabase);

const idOf = async (slug: string) => (await prisma.category.findUniqueOrThrow({ where: { slug } })).id;

describe('categories', () => {
  it('lists the groups with every category, including inactive ones and draft products in the counts', async () => {
    await createCategory('lamps', 'Lamps', 'type');
    await createCategory('retired', 'Retired', 'type');
    await prisma.category.update({ where: { slug: 'retired' }, data: { isActive: false } });
    await createProduct({ name: 'Draft Lamp', status: 'DRAFT', categories: ['lamps'] });

    const res = await api.get('/api/admin/categories');
    expect(res.status).toBe(200);
    expect(res.body.groups.map((g: { slug: string }) => g.slug)).toEqual(['type', 'occasion', 'recipient']);

    const type = res.body.groups[0];
    expect(type.categories.map((c: { slug: string }) => c.slug).sort()).toEqual(['lamps', 'retired']);
    expect(type.categories.find((c: { slug: string }) => c.slug === 'lamps').productCount).toBe(1);
    expect(type.categories.find((c: { slug: string }) => c.slug === 'retired').isActive).toBe(false);
  });

  it('creates a category inside a group with an automatic link and the next sort position', async () => {
    const parentId = await idOf('type');
    const first = await api.post('/api/admin/categories').send({ parentId, name: 'Night Lamps' });
    const second = await api.post('/api/admin/categories').send({ parentId, name: 'Night Lamps' });

    expect(first.status).toBe(201);
    expect(first.body.category).toMatchObject({ slug: 'night-lamps', name: 'Night Lamps', isActive: true, productCount: 0 });
    expect(second.body.category.slug).toBe('night-lamps-2');
    expect(second.body.category.sortOrder).toBe(first.body.category.sortOrder + 1);
  });

  it('refuses a taken link, an unknown group, and creating inside a normal category', async () => {
    await createCategory('lamps', 'Lamps', 'type');
    const parentId = await idOf('type');

    const taken = await api.post('/api/admin/categories').send({ parentId, name: 'More Lamps', slug: 'lamps' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('SLUG_TAKEN');

    const unknown = await api.post('/api/admin/categories').send({ parentId: UNKNOWN_ID, name: 'X' });
    expect(unknown.body.error.code).toBe('UNKNOWN_PARENT');

    const nested = await api.post('/api/admin/categories').send({ parentId: await idOf('lamps'), name: 'X' });
    expect(nested.body.error.code).toBe('NOT_A_GROUP');
  });

  it('edits a category and refuses a link used elsewhere', async () => {
    const lamps = await createCategory('lamps', 'Lamps', 'type');
    await createCategory('frames', 'Frames', 'type');

    const ok = await api.patch(`/api/admin/categories/${lamps.id}`).send({ name: 'Table Lamps', description: 'Glow', sortOrder: 9 });
    expect(ok.body.category).toMatchObject({ name: 'Table Lamps', description: 'Glow', sortOrder: 9, slug: 'lamps' });

    expect((await api.patch(`/api/admin/categories/${lamps.id}`).send({ slug: 'frames' })).status).toBe(409);
    expect((await api.patch(`/api/admin/categories/${UNKNOWN_ID}`).send({ name: 'X' })).status).toBe(404);
  });

  it('removes a deactivated category from the public menu', async () => {
    const lamps = await createCategory('lamps', 'Lamps', 'type');
    await createProduct({ name: 'Heart Lamp', categories: ['lamps'] });
    expect((await request(app).get('/api/categories')).body.groups).toHaveLength(1);

    await api.patch(`/api/admin/categories/${lamps.id}`).send({ isActive: false });
    expect((await request(app).get('/api/categories')).body.groups).toHaveLength(0);
  });

  it('keeps the three groups fixed: no new link, no deactivation, no delete, but they can be renamed', async () => {
    const type = await idOf('type');

    for (const body of [{ slug: 'kinds' }, { isActive: false }]) {
      const res = await api.patch(`/api/admin/categories/${type}`).send(body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('GROUP_LOCKED');
    }
    expect((await api.patch(`/api/admin/categories/${type}`).send({ name: 'Product type' })).status).toBe(200);
    expect((await api.delete(`/api/admin/categories/${type}`)).status).toBe(409);
  });

  it('deletes an empty category but refuses one that still has products', async () => {
    const empty = await createCategory('empty', 'Empty', 'type');
    const used = await createCategory('used', 'Used', 'type');
    await createProduct({ name: 'Heart Lamp', status: 'DRAFT', categories: ['used'] });

    expect((await api.delete(`/api/admin/categories/${empty.id}`)).status).toBe(204);
    expect(await prisma.category.count({ where: { slug: 'empty' } })).toBe(0);

    const blocked = await api.delete(`/api/admin/categories/${used.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CATEGORY_IN_USE');
  });
});

describe('inventory list', () => {
  it('lists variants with their stock state, most urgent first, and counts what needs attention', async () => {
    await createProduct({ name: 'Plain Lamp', variants: [{ stock: 50 }] });
    await createProduct({ name: 'Low Lamp', variants: [{ stock: 3, lowStockThreshold: 5 }] });
    await createProduct({ name: 'Empty Lamp', variants: [{ stock: 0 }] });
    await createProduct({ name: 'Made Lamp', variants: [{ track: false, stock: 0 }] });
    await createProduct({ name: 'Archived Lamp', status: 'ARCHIVED', variants: [{ stock: 0 }] });

    const res = await api.get('/api/admin/inventory');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { product: { name: string } }) => i.product.name)).toEqual(['Empty Lamp', 'Low Lamp', 'Plain Lamp', 'Made Lamp']);
    expect(res.body.items.map((i: { state: string }) => i.state)).toEqual(['OUT', 'LOW', 'OK', 'MADE_TO_ORDER']);
    expect(res.body.summary).toEqual({ out: 1, low: 1 });
  });

  it('filters by state and searches by product name or SKU', async () => {
    const low = await createProduct({ name: 'Low Lamp', variants: [{ stock: 3 }] });
    await createProduct({ name: 'Empty Frame', variants: [{ stock: 0 }] });
    await createProduct({ name: 'Plain Lamp', variants: [{ stock: 50 }] });
    const sku = (await prisma.productVariant.findFirstOrThrow({ where: { productId: low.id } })).sku;

    const names = async (q: string) => (await api.get(`/api/admin/inventory?${q}`)).body.items.map((i: { product: { name: string } }) => i.product.name);
    expect(await names('state=attention')).toEqual(['Empty Frame', 'Low Lamp']);
    expect(await names('state=out')).toEqual(['Empty Frame']);
    expect(await names('q=lamp')).toEqual(['Low Lamp', 'Plain Lamp']);
    expect(await names(`q=${sku}`)).toEqual(['Low Lamp']);
  });
});

describe('POST /api/admin/variants/:variantId/stock', () => {
  const setup = async (stock = 10, track = true) => {
    const product = await createProduct({ name: 'Heart Lamp', variants: [{ stock, track }] });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    return { variant, url: `/api/admin/variants/${variant.id}/stock` };
  };
  const stockOf = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stockQuantity;

  it('adds and removes stock and records who did it and why', async () => {
    const { variant, url } = await setup(10);

    const add = await api.post(url).send({ mode: 'adjust', quantity: 5, reason: 'RESTOCK', note: 'New batch' });
    expect(add.status).toBe(200);
    expect(add.body).toMatchObject({ stockBefore: 10, stockAfter: 15, change: 5 });

    const remove = await api.post(url).send({ mode: 'adjust', quantity: -2, note: 'Damaged' });
    expect(remove.body).toMatchObject({ stockAfter: 13, change: -2 });

    const ledger = await prisma.inventoryTransaction.findMany({ where: { variantId: variant.id }, orderBy: { createdAt: 'asc' } });
    expect(ledger.map((l) => [l.quantityChange, l.stockAfter, l.reason])).toEqual([
      [5, 15, 'RESTOCK'],
      [-2, 13, 'ADJUSTMENT'],
    ]);
    expect(ledger[0]).toMatchObject({ createdById: adminId, note: 'New batch' });
  });

  it('sets stock to an exact count by logging the difference', async () => {
    const { variant, url } = await setup(10);
    const res = await api.post(url).send({ mode: 'set', quantity: 4 });

    expect(res.body).toMatchObject({ stockBefore: 10, stockAfter: 4, change: -6 });
    expect(await stockOf(variant.id)).toBe(4);
  });

  it('never lets stock go below zero and changes nothing when it refuses', async () => {
    const { variant, url } = await setup(3);
    const res = await api.post(url).send({ mode: 'adjust', quantity: -4 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(variant.id)).toBe(3);
    expect(await prisma.inventoryTransaction.count({ where: { variantId: variant.id } })).toBe(0);
  });

  it('refuses a change of zero, a negative set, a wrong reason and unknown fields', async () => {
    const { url } = await setup(3);

    expect((await api.post(url).send({ mode: 'set', quantity: 3 })).body.error.code).toBe('NO_CHANGE');
    expect((await api.post(url).send({ mode: 'adjust', quantity: 0 })).body.error.code).toBe('NO_CHANGE');
    expect((await api.post(url).send({ mode: 'set', quantity: -1 })).status).toBe(400);
    expect((await api.post(url).send({ mode: 'adjust', quantity: -1, reason: 'RESTOCK' })).body.error.code).toBe('REASON_MISMATCH');
    expect((await api.post(url).send({ mode: 'adjust', quantity: 1.5 })).status).toBe(400);
    expect((await api.post(url).send({ mode: 'adjust', quantity: 1, reason: 'RESERVED' })).status).toBe(400);
  });

  it('refuses a made-to-order variant and an unknown variant', async () => {
    const { url } = await setup(0, false);
    const res = await api.post(url).send({ mode: 'adjust', quantity: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_TRACKED');

    expect((await api.post(`/api/admin/variants/${UNKNOWN_ID}/stock`).send({ mode: 'adjust', quantity: 1 })).status).toBe(404);
  });

  it('does not lose updates when several adjustments arrive at once', async () => {
    const { variant, url } = await setup(3);
    const results = await Promise.all(Array.from({ length: 5 }, () => api.post(url).send({ mode: 'adjust', quantity: -1 })));

    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await stockOf(variant.id)).toBe(0);
    expect(await prisma.inventoryTransaction.count({ where: { variantId: variant.id } })).toBe(3);
  });

  it('shows the history newest first with the admin name, and paginates', async () => {
    const { variant, url } = await setup(10);
    for (const quantity of [1, 2, 3]) await api.post(url).send({ mode: 'adjust', quantity });

    const res = await api.get(`/api/admin/variants/${variant.id}/stock-history?pageSize=2`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { change: number }) => i.change)).toEqual([3, 2]);
    expect(res.body.items[0].createdBy).toEqual({ id: adminId, name: 'Test' });
    expect(res.body).toMatchObject({ total: 3, totalPages: 2, variant: { id: variant.id, stockQuantity: 16 } });

    expect((await api.get(`/api/admin/variants/${UNKNOWN_ID}/stock-history`)).status).toBe(404);
  });
});

describe('customers', () => {
  const login = (email: string) => request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: 'Sup3r-secret-pass' });

  it('lists customers only, with search, status filter, order count and money spent', async () => {
    const ann = await createUser({ email: 'ann@example.com' });
    await prisma.user.update({ where: { id: ann.id }, data: { firstName: 'Ann', lastName: 'Rao' } });
    const bob = await createUser({ email: 'bob@example.com', isActive: false });
    const product = await createProduct({ name: 'Heart Lamp', variants: [{ price: 250 }] });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await createOrderFor(product.id, variant.id, { userId: ann.id, paid: true });
    await createOrderFor(product.id, variant.id, { userId: ann.id, paid: false });

    const all = await api.get('/api/admin/customers');
    expect(all.body.total).toBe(2);
    expect(all.body.items.map((c: { email: string }) => c.email)).not.toContain('admin@example.com');
    expect(all.body.items.find((c: { id: string }) => c.id === ann.id)).toMatchObject({ name: 'Ann Rao', orderCount: 2, totalSpent: '250.00', isActive: true });
    expect(all.body.items.find((c: { id: string }) => c.id === bob.id)).toMatchObject({ orderCount: 0, totalSpent: '0.00', isActive: false });

    const ids = async (q: string) => (await api.get(`/api/admin/customers?${q}`)).body.items.map((c: { id: string }) => c.id);
    expect(await ids('q=rao')).toEqual([ann.id]);
    expect(await ids('q=BOB@')).toEqual([bob.id]);
    expect(await ids('status=inactive')).toEqual([bob.id]);
  });

  it('shows a customer profile with addresses and recent orders but no password data', async () => {
    const ann = await createUser({ email: 'ann@example.com' });
    await prisma.address.create({
      data: { userId: ann.id, recipientName: 'Ann', phone: '+919999999999', line1: '1 Street', city: 'Pune', state: 'MH', postalCode: '411001', isDefault: true },
    });

    const res = await api.get(`/api/admin/customers/${ann.id}`);
    expect(res.status).toBe(200);
    expect(res.body.customer).toMatchObject({ email: 'ann@example.com', orderCount: 0 });
    expect(res.body.customer.addresses).toHaveLength(1);
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('password');
  });

  it('blocks a customer, ends their sessions at once, and lets them back in when reactivated', async () => {
    const ann = await createUser({ email: 'ann@example.com' });
    const session = await signInAs(app, 'ann@example.com');
    expect((await session.get('/api/auth/me')).status).toBe(200);

    const blocked = await api.patch(`/api/admin/customers/${ann.id}`).send({ isActive: false });
    expect(blocked.status).toBe(200);
    expect(blocked.body.customer.isActive).toBe(false);
    expect((await session.get('/api/auth/me')).status).toBe(401);
    expect((await login('ann@example.com')).status).not.toBe(200);

    await api.patch(`/api/admin/customers/${ann.id}`).send({ isActive: true });
    expect((await login('ann@example.com')).status).toBe(200);
  });

  it('cannot reach admin accounts through the customer endpoints', async () => {
    expect((await api.get(`/api/admin/customers/${adminId}`)).status).toBe(404);
    expect((await api.patch(`/api/admin/customers/${adminId}`).send({ isActive: false })).status).toBe(404);
    expect((await api.get('/api/admin/products')).status).toBe(200);
  });
});

describe('settings', () => {
  it('returns defaults before anything is saved', async () => {
    const res = await api.get('/api/admin/settings');
    expect(res.status).toBe(200);
    expect(res.body.shipping).toMatchObject({ flatFee: 0, freeAbove: null });
  });

  it('saves shipping, keeps unmanaged keys such as currency, and shows it on the public settings', async () => {
    await prisma.storeSetting.create({ data: { key: 'shipping', value: { flat_fee: 40, free_above: 499, currency: 'INR' } } });

    const res = await api.put('/api/admin/settings/shipping').send({ flatFee: 60, freeAbove: 799.5 });
    expect(res.status).toBe(200);
    expect(res.body.shipping).toEqual({ flatFee: 60, freeAbove: 799.5, currency: 'INR' });

    const row = await prisma.storeSetting.findUniqueOrThrow({ where: { key: 'shipping' } });
    expect(row.value).toEqual({ flat_fee: 60, free_above: 799.5, currency: 'INR' });
    expect(row.updatedById).toBe(adminId);
    expect((await request(app).get('/api/store/settings')).body.shipping.flatFee).toBe(60);
  });

  it('allows switching free shipping off', async () => {
    const res = await api.put('/api/admin/settings/shipping').send({ flatFee: 40, freeAbove: null });
    expect(res.body.shipping.freeAbove).toBeNull();
  });

  it('rejects invalid shipping values and unknown keys', async () => {
    for (const body of [{ flatFee: -1, freeAbove: null }, { flatFee: 'free', freeAbove: null }, { flatFee: 10, freeAbove: null, currency: 'USD' }, { flatFee: 10 }]) {
      expect((await api.put('/api/admin/settings/shipping').send(body)).status).toBe(400);
    }
  });

  it('saves delivery times and checks that the minimum is not above the maximum', async () => {
    const bad = await api.put('/api/admin/settings/delivery').send({ minDays: 7, maxDays: 3, productionDays: 2 });
    expect(bad.status).toBe(400);

    const ok = await api.put('/api/admin/settings/delivery').send({ minDays: 3, maxDays: 5, productionDays: 2 });
    expect(ok.body.delivery).toEqual({ minDays: 3, maxDays: 5, productionDays: 2 });
  });

  it('saves the business profile and validates the GSTIN, email, phone and PIN code', async () => {
    const profile = {
      displayName: 'Gridcart',
      legalName: 'Gridcart Gifts',
      gstin: '29abcde1234f1z5',
      address: { line1: '12 MG Road', line2: null, city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' },
      supportEmail: 'help@example.com',
      supportPhone: '+91 98765 43210',
    };

    const ok = await api.put('/api/admin/settings/store').send(profile);
    expect(ok.status).toBe(200);
    expect(ok.body.store).toMatchObject({ legalName: 'Gridcart Gifts', gstin: '29ABCDE1234F1Z5', supportEmail: 'help@example.com' });
    expect(ok.body.store.address).toMatchObject({ city: 'Bengaluru', postalCode: '560001', country: 'IN' });

    const row = await prisma.storeSetting.findUniqueOrThrow({ where: { key: 'store_profile' } });
    expect(row.value).toMatchObject({ display_name: 'Gridcart', address: { postal_code: '560001' } });

    for (const patch of [{ gstin: '123' }, { supportEmail: 'nope' }, { supportPhone: 'call me' }, { address: { ...profile.address, postalCode: '12' } }]) {
      const res = await api.put('/api/admin/settings/store').send({ ...profile, ...patch });
      expect(res.status, JSON.stringify(patch)).toBe(400);
    }
  });
});
