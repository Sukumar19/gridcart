import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { closeDatabase, createCatalogGroups, createCategory, createProduct, resetDatabase } from './helpers';

let app: ReturnType<typeof createApp>;
const get = (url: string) => request(app).get(url);
const names = (res: request.Response) => res.body.items.map((i: { name: string }) => i.name);

beforeEach(async () => {
  app = createApp();
  await resetDatabase();
  await createCatalogGroups();
  await createCategory('lamps', 'Lamps', 'type');
  await createCategory('frames', 'Frames', 'type');
  await createCategory('keychains', 'Keychains', 'type');
  await createCategory('birthday', 'Birthday', 'occasion');
  await createCategory('for-her', 'For her', 'recipient');
});

afterAll(closeDatabase);

describe('GET /api/categories', () => {
  it('lists only categories that have active products, grouped, with counts', async () => {
    await createProduct({ name: 'Heart Lamp', categories: ['lamps', 'birthday'] });
    await createProduct({ name: 'Moon Lamp', categories: ['lamps'] });
    await createProduct({ name: 'Draft Frame', status: 'DRAFT', categories: ['frames'] });
    await createProduct({ name: 'Old Keychain', status: 'ARCHIVED', categories: ['keychains'] });

    const res = await get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.groups.map((g: { slug: string }) => g.slug)).toEqual(['type', 'occasion']);

    const type = res.body.groups[0];
    expect(type.categories).toHaveLength(1);
    expect(type.categories[0]).toMatchObject({ slug: 'lamps', name: 'Lamps', productCount: 2 });
    expect(res.body.groups[1].categories[0]).toMatchObject({ slug: 'birthday', productCount: 1 });
  });

  it('can be cached briefly by browsers', async () => {
    const res = await get('/api/categories');
    expect(res.headers['cache-control']).toMatch(/public, max-age=30/);
  });
});

describe('GET /api/products', () => {
  it('shows only active products that have an active variant', async () => {
    await createProduct({ name: 'Live One' });
    await createProduct({ name: 'Draft One', status: 'DRAFT' });
    await createProduct({ name: 'Archived One', status: 'ARCHIVED' });
    await createProduct({ name: 'No Variant', variants: [{ active: false }] });

    const res = await get('/api/products');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Live One']);
    expect(res.body.total).toBe(1);
  });

  it('returns card data with string prices, discount, stock state and an absolute image URL', async () => {
    await createProduct({ name: 'Heart Lamp', variants: [{ price: 499, compareAt: 999 }], images: 2 });
    const [card] = (await get('/api/products')).body.items;

    expect(card).toMatchObject({
      name: 'Heart Lamp',
      price: '499.00',
      compareAtPrice: '999.00',
      discountPercent: 50,
      inStock: true,
      priceVaries: false,
    });
    expect(card.image.url).toMatch(/^http:\/\/api\.test\/media\/heart-lamp-\d+\/0\.webp$/);
  });

  it('ignores a compare-at price that is not higher than the price (no fake discounts)', async () => {
    await createProduct({ name: 'Plain', variants: [{ price: 200, compareAt: 200 }] });
    const [card] = (await get('/api/products')).body.items;
    expect(card.compareAtPrice).toBeNull();
    expect(card.discountPercent).toBeNull();
  });

  it('shows the lowest variant price and flags when prices vary', async () => {
    await createProduct({ name: 'Frame', variants: [{ price: 300, size: 'big' }, { price: 150, size: 'small' }] });
    const [card] = (await get('/api/products')).body.items;
    expect(card).toMatchObject({ price: '150.00', priceVaries: true });
  });

  it('paginates', async () => {
    for (let i = 1; i <= 5; i++) await createProduct({ name: `Item ${i}`, createdAt: new Date(2026, 0, i) });
    const p1 = await get('/api/products?pageSize=2&page=1');
    const p3 = await get('/api/products?pageSize=2&page=3');

    expect(names(p1)).toEqual(['Item 5', 'Item 4']);
    expect(p1.body).toMatchObject({ total: 5, totalPages: 3, page: 1, pageSize: 2 });
    expect(names(p3)).toEqual(['Item 1']);
  });

  it('filters by type, occasion and recipient (AND across groups, OR within a group)', async () => {
    await createProduct({ name: 'Lamp Birthday', categories: ['lamps', 'birthday'] });
    await createProduct({ name: 'Lamp Plain', categories: ['lamps'] });
    await createProduct({ name: 'Frame Birthday', categories: ['frames', 'birthday'] });
    await createProduct({ name: 'Frame Her', categories: ['frames', 'for-her'] });

    expect(names(await get('/api/products?type=lamps')).sort()).toEqual(['Lamp Birthday', 'Lamp Plain']);
    expect(names(await get('/api/products?type=lamps,frames&sort=newest')).sort()).toEqual(['Frame Birthday', 'Frame Her', 'Lamp Birthday', 'Lamp Plain']);
    expect(names(await get('/api/products?type=lamps&occasion=birthday'))).toEqual(['Lamp Birthday']);
    expect(names(await get('/api/products?occasion=birthday')).sort()).toEqual(['Frame Birthday', 'Lamp Birthday']);
    expect(names(await get('/api/products?recipient=for-her'))).toEqual(['Frame Her']);
  });

  it('does not let a category slug match the wrong group', async () => {
    await createProduct({ name: 'Lamp Birthday', categories: ['lamps', 'birthday'] });
    expect(names(await get('/api/products?type=birthday'))).toEqual([]);
  });

  it('filters personalised products, price range and stock', async () => {
    await createProduct({ name: 'Photo Lamp', personalised: true, variants: [{ price: 600 }] });
    await createProduct({ name: 'Cheap Toy', variants: [{ price: 120 }] });
    await createProduct({ name: 'Sold Out', variants: [{ price: 300, stock: 0 }] });
    await createProduct({ name: 'Made To Order', variants: [{ price: 300, stock: 0, track: false }] });

    expect(names(await get('/api/products?personalised=true'))).toEqual(['Photo Lamp']);
    expect(names(await get('/api/products?minPrice=200&maxPrice=400')).sort()).toEqual(['Made To Order', 'Sold Out']);
    expect(names(await get('/api/products?inStock=true')).sort()).toEqual(['Cheap Toy', 'Made To Order', 'Photo Lamp']);
  });

  it('sorts by price and by featured', async () => {
    await createProduct({ name: 'Mid', variants: [{ price: 300 }], createdAt: new Date(2026, 0, 1) });
    await createProduct({ name: 'Low', variants: [{ price: 100 }], createdAt: new Date(2026, 0, 2) });
    await createProduct({ name: 'High', variants: [{ price: 900 }], featured: true, createdAt: new Date(2026, 0, 3) });

    expect(names(await get('/api/products?sort=price_asc'))).toEqual(['Low', 'Mid', 'High']);
    expect(names(await get('/api/products?sort=price_desc'))).toEqual(['High', 'Mid', 'Low']);
    expect((await get('/api/products?sort=featured')).body.items[0].name).toBe('High');
    expect(names(await get('/api/products'))).toEqual(['High', 'Low', 'Mid']);
  });

  it('searches by substring, ignoring case, and tolerates typos', async () => {
    await createProduct({ name: 'Heart LED Lamp' });
    await createProduct({ name: 'Photo Frame' });
    await createProduct({ name: 'Draft Heart Thing', status: 'DRAFT' });

    expect(names(await get('/api/products?q=heart'))).toEqual(['Heart LED Lamp']);
    expect(names(await get('/api/products?q=LAMP'))).toEqual(['Heart LED Lamp']);
    expect(names(await get('/api/products?q=hart led lamp'))).toEqual(['Heart LED Lamp']);
    expect(names(await get('/api/products?q=zzzzqq'))).toEqual([]);
  });

  it('combines search with filters and treats percent signs as plain text', async () => {
    await createProduct({ name: 'Heart Lamp', categories: ['lamps'] });
    await createProduct({ name: 'Heart Frame', categories: ['frames'] });
    expect(names(await get('/api/products?q=heart&type=frames'))).toEqual(['Heart Frame']);
    expect(names(await get('/api/products?q=%25'))).toEqual([]);
  });

  it.each([
    ['page=0'],
    ['pageSize=1000'],
    ['sort=bogus'],
    ['minPrice=-5'],
    ['minPrice=500&maxPrice=100'],
    ['type=Bad%20Slug!'],
    ['personalised=maybe'],
  ])('rejects invalid query %s with 400', async (qs) => {
    const res = await get(`/api/products?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/products/:slug', () => {
  it('returns the full product with ordered images, variants and related products', async () => {
    await createProduct({ name: 'Other Lamp', categories: ['lamps'], images: 1 });
    await createProduct({ name: 'Other Frame', categories: ['frames'] });
    const lamp = await createProduct({
      name: 'Photo Lamp',
      categories: ['lamps', 'birthday'],
      personalised: true,
      images: 3,
      variants: [{ price: 499, compareAt: 799, color: 'Warm' }, { price: 599, color: 'Cool', stock: 3 }],
    });
    await prisma.product.update({ where: { id: lamp.id }, data: { description: 'Glows.', customizationNote: 'Upload a clear photo', maxCustomImages: 2 } });

    const res = await get(`/api/products/${lamp.slug}`);
    expect(res.status).toBe(200);
    const p = res.body.product;

    expect(p).toMatchObject({ name: 'Photo Lamp', description: 'Glows.', isCustomizable: true, maxCustomImages: 2, customizationNote: 'Upload a clear photo' });
    expect(p.categories).toEqual(expect.arrayContaining([{ slug: 'lamps', name: 'Lamps', group: 'type' }, { slug: 'birthday', name: 'Birthday', group: 'occasion' }]));
    expect(p.images).toHaveLength(3);
    expect(p.images[0].isPrimary).toBe(true);
    expect(p.variants[0]).toMatchObject({ color: 'Warm', price: '499.00', compareAtPrice: '799.00', discountPercent: 38, inStock: true, madeToOrder: false, stockLeft: null });
    expect(p.related.map((r: { name: string }) => r.name)).toEqual(['Other Lamp']);
  });

  it('only reveals remaining stock when it is low, and never exposes tax or internal fields', async () => {
    const lamp = await createProduct({ name: 'Lamp', variants: [{ stock: 3, lowStockThreshold: 5 }, { stock: 50, color: 'x' }, { track: false, stock: 0, color: 'y' }] });
    const body = (await get(`/api/products/${lamp.slug}`)).body.product;

    expect(body.variants.map((v: { stockLeft: number | null }) => v.stockLeft)).toEqual([3, null, null]);
    expect(body.variants[2]).toMatchObject({ madeToOrder: true, inStock: true });
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/gstRate|hsnCode|stockQuantity|status/);
  });

  it('hides non-personalisable upload settings', async () => {
    const plain = await createProduct({ name: 'Plain Toy' });
    const p = (await get(`/api/products/${plain.slug}`)).body.product;
    expect(p.maxCustomImages).toBeNull();
    expect(p.customizationNote).toBeNull();
  });

  it.each([['DRAFT'], ['ARCHIVED']] as const)('returns 404 for %s products and unknown slugs', async (status) => {
    const hidden = await createProduct({ name: 'Hidden', status });
    expect((await get(`/api/products/${hidden.slug}`)).status).toBe(404);
    expect((await get('/api/products/does-not-exist')).status).toBe(404);
    expect((await get('/api/products/Bad%20Slug')).status).toBe(400);
  });
});

describe('GET /api/store/settings', () => {
  it('returns shipping, delivery and public store details from settings, with safe defaults', async () => {
    expect((await get('/api/store/settings')).body.shipping).toMatchObject({ flatFee: 0, freeAbove: null });

    await prisma.storeSetting.createMany({
      data: [
        { key: 'shipping', value: { flat_fee: 40, free_above: 499, currency: 'INR' } },
        { key: 'delivery', value: { min_days: 3, max_days: 5, production_days: null } },
        { key: 'store_profile', value: { display_name: 'Gridcart', address: { city: 'Chennai', state: 'Tamil Nadu', postal_code: '600021' } } },
      ],
    });
    const res = await get('/api/store/settings');
    expect(res.status).toBe(200);
    expect(res.body.shipping).toEqual({ flatFee: 40, freeAbove: 499, currency: 'INR' });
    expect(res.body.delivery).toEqual({ minDays: 3, maxDays: 5, productionDays: null });
    expect(res.body.store).toMatchObject({ displayName: 'Gridcart', address: { city: 'Chennai', postalCode: '600021' } });
  });
});
