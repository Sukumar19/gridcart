import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { uploadRoot } from '../src/lib/storage/local';
import { closeDatabase, createCatalogGroups, createImageRow, createProduct, createUser, resetDatabase, signInAs, type Api } from './helpers';

const UNKNOWN_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

let api: Api;
let product: { id: string; slug: string };

const png = (width = 60, height = 40, background = '#fa6903') =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

const imagesUrl = (productId = product.id, suffix = '') => `/api/admin/products/${productId}/images${suffix}`;

// Maps an image URL from the API back to the file on disk.
const fileOf = (url: string) => path.join(uploadRoot, new URL(url).pathname.replace(/^\/media\//, ''));

const upload = async (files: { data: Buffer; name?: string; type?: string }[], productId = product.id) => {
  const req = api.post(imagesUrl(productId));
  files.forEach((f, i) => req.attach('images', f.data, { filename: f.name ?? `photo-${i}.png`, contentType: f.type ?? 'image/png' }));
  return req;
};

beforeEach(async () => {
  const app = createApp();
  await resetDatabase();
  await createCatalogGroups();
  await createUser({ email: 'admin@example.com', role: 'ADMIN' });
  api = await signInAs(app, 'admin@example.com');
  product = await createProduct({ name: 'Heart Lamp', status: 'DRAFT' });
});

afterAll(async () => {
  await rm(uploadRoot, { recursive: true, force: true });
  await closeDatabase();
});

describe('POST /api/admin/products/:id/images', () => {
  it('stores photos as WebP, makes the first one primary and keeps the order', async () => {
    const res = await upload([{ data: await png() }, { data: await png(80, 80, '#6c2704') }]);

    expect(res.status).toBe(201);
    expect(res.body.images).toHaveLength(2);
    expect(res.body.images.map((i: { isPrimary: boolean }) => i.isPrimary)).toEqual([true, false]);
    expect(res.body.images.map((i: { sortOrder: number }) => i.sortOrder)).toEqual([0, 1]);
    expect(res.body.images[0]).toMatchObject({ width: 60, height: 40 });
    for (const image of res.body.images) {
      expect(image.url.startsWith(`http://api.test/media/${product.slug}/`)).toBe(true);
      expect(image.url.endsWith('.webp')).toBe(true);
      expect(existsSync(fileOf(image.url))).toBe(true);
    }
  });

  it('appends later uploads without changing the primary photo', async () => {
    await upload([{ data: await png() }]);
    const second = await upload([{ data: await png() }]);

    expect(second.body.images[0]).toMatchObject({ isPrimary: false, sortOrder: 1 });
    const stored = await prisma.productImage.findMany({ where: { productId: product.id } });
    expect(stored.filter((i) => i.isPrimary)).toHaveLength(1);
  });

  it('rejects content that is not an image even when it claims to be a PNG', async () => {
    const res = await upload([{ data: Buffer.from('this is just text') }]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IMAGE');
    expect(await prisma.productImage.count()).toBe(0);
  });

  it('rejects other image formats such as GIF and SVG, whatever the declared type', async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).gif().toBuffer();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');

    for (const data of [gif, svg]) {
      const res = await upload([{ data }]);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_IMAGE');
    }
    expect(await prisma.productImage.count()).toBe(0);
  });

  it('rejects a declared type that is not JPG, PNG or WebP', async () => {
    const res = await upload([{ data: await png(), name: 'x.gif', type: 'image/gif' }]);
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA');
  });

  it('rejects a file over the size limit', async () => {
    const res = await upload([{ data: Buffer.alloc(8 * 1024 * 1024 + 10, 1) }]);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('keeps nothing when one photo in a batch is invalid', async () => {
    const res = await upload([{ data: await png() }, { data: Buffer.from('not an image') }]);
    expect(res.status).toBe(400);
    expect(await prisma.productImage.count()).toBe(0);

    const folder = path.join(uploadRoot, product.slug);
    expect(existsSync(folder) ? await readdir(folder) : []).toEqual([]);
  });

  it('rejects an empty request, too many files and photos in the wrong field', async () => {
    expect((await api.post(imagesUrl()).send({})).body.error.code).toBe('NO_FILES');

    const many = await upload(Array.from({ length: 9 }, () => ({ data: Buffer.from('x') })));
    expect(many.status).toBe(400);
    expect(many.body.error.code).toBe('UPLOAD_ERROR');

    const wrongField = await api.post(imagesUrl()).attach('photo', await png(), { filename: 'a.png', contentType: 'image/png' });
    expect(wrongField.status).toBe(400);
    expect(wrongField.body.error.code).toBe('UPLOAD_ERROR');
  });

  it('enforces the per-product photo limit', async () => {
    for (let i = 0; i < 12; i += 1) await createImageRow(product.id, { primary: i === 0, sortOrder: i });
    const res = await upload([{ data: await png() }]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOO_MANY_IMAGES');
  });

  it('returns 404 for an unknown product', async () => {
    expect((await upload([{ data: await png() }], UNKNOWN_ID)).status).toBe(404);
  });
});

describe('editing photos', () => {
  const addTwo = async () => (await upload([{ data: await png() }, { data: await png(80, 80) }])).body.images as { id: string; isPrimary: boolean }[];

  it('sets alt text and clears it again', async () => {
    const [first] = await addTwo();
    const set = await api.patch(imagesUrl(product.id, `/${first!.id}`)).send({ altText: 'Pink heart lamp glowing' });
    expect(set.body.images.find((i: { id: string }) => i.id === first!.id).altText).toBe('Pink heart lamp glowing');

    const cleared = await api.patch(imagesUrl(product.id, `/${first!.id}`)).send({ altText: '' });
    expect(cleared.body.images.find((i: { id: string }) => i.id === first!.id).altText).toBeNull();
  });

  it('makes another photo primary and always leaves exactly one primary', async () => {
    const [first, second] = await addTwo();
    const res = await api.patch(imagesUrl(product.id, `/${second!.id}`)).send({ isPrimary: true });

    expect(res.status).toBe(200);
    expect(res.body.images[0].id).toBe(second!.id);
    expect(res.body.images.filter((i: { isPrimary: boolean }) => i.isPrimary).map((i: { id: string }) => i.id)).toEqual([second!.id]);
    expect(res.body.images.find((i: { id: string }) => i.id === first!.id).isPrimary).toBe(false);
  });

  it('cannot unset the primary photo directly', async () => {
    const [first] = await addTwo();
    expect((await api.patch(imagesUrl(product.id, `/${first!.id}`)).send({ isPrimary: false })).status).toBe(400);
  });

  it('links a photo to a variant of the same product only', async () => {
    const [first] = await addTwo();
    const own = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    const other = await createProduct({ name: 'Other Lamp' });
    const foreign = await prisma.productVariant.findFirstOrThrow({ where: { productId: other.id } });

    const ok = await api.patch(imagesUrl(product.id, `/${first!.id}`)).send({ variantId: own.id });
    expect(ok.body.images.find((i: { id: string }) => i.id === first!.id).variantId).toBe(own.id);

    const bad = await api.patch(imagesUrl(product.id, `/${first!.id}`)).send({ variantId: foreign.id });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('UNKNOWN_VARIANT');

    const unlink = await api.patch(imagesUrl(product.id, `/${first!.id}`)).send({ variantId: null });
    expect(unlink.body.images.find((i: { id: string }) => i.id === first!.id).variantId).toBeNull();
  });

  it('does not touch a photo through the wrong product', async () => {
    const [first] = await addTwo();
    const other = await createProduct({ name: 'Other Lamp' });
    expect((await api.patch(imagesUrl(other.id, `/${first!.id}`)).send({ altText: 'x' })).status).toBe(404);
  });

  it('reorders photos', async () => {
    const [first, second] = await addTwo();
    const res = await api.put(imagesUrl(product.id, '/order')).send({ imageIds: [second!.id, first!.id] });

    expect(res.status).toBe(200);
    const order = await prisma.productImage.findMany({ where: { productId: product.id }, orderBy: { sortOrder: 'asc' } });
    expect(order.map((i) => i.id)).toEqual([second!.id, first!.id]);
  });

  it('refuses an order that omits, repeats or invents photos', async () => {
    const [first, second] = await addTwo();
    for (const imageIds of [[first!.id], [first!.id, first!.id], [first!.id, UNKNOWN_ID], [first!.id, second!.id, UNKNOWN_ID]]) {
      const res = await api.put(imagesUrl(product.id, '/order')).send({ imageIds });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('IMAGE_SET_MISMATCH');
    }
  });
});

describe('DELETE /api/admin/products/:id/images/:imageId', () => {
  const addTwo = async () => (await upload([{ data: await png() }, { data: await png(80, 80) }])).body.images as { id: string; url: string }[];

  it('removes the photo and its file, and promotes the next photo when the primary goes', async () => {
    const [first, second] = await addTwo();
    const res = await api.delete(imagesUrl(product.id, `/${first!.id}`));

    expect(res.status).toBe(200);
    expect(res.body.images).toHaveLength(1);
    expect(res.body.images[0]).toMatchObject({ id: second!.id, isPrimary: true });
    expect(existsSync(fileOf(first!.url))).toBe(false);
    expect(existsSync(fileOf(second!.url))).toBe(true);
  });

  it('refuses to remove the last photo of a live product but allows it on a draft', async () => {
    const [first, second] = await addTwo();
    await prisma.product.update({ where: { id: product.id }, data: { status: 'ACTIVE' } });

    expect((await api.delete(imagesUrl(product.id, `/${first!.id}`))).status).toBe(200);
    const blocked = await api.delete(imagesUrl(product.id, `/${second!.id}`));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('LIVE_PRODUCT_INCOMPLETE');
    expect(existsSync(fileOf(second!.url))).toBe(true);

    await prisma.product.update({ where: { id: product.id }, data: { status: 'DRAFT' } });
    expect((await api.delete(imagesUrl(product.id, `/${second!.id}`))).status).toBe(200);
  });

  it('removes the files when the whole product is deleted', async () => {
    const images = await addTwo();
    expect((await api.delete(`/api/admin/products/${product.id}`)).status).toBe(204);
    for (const image of images) expect(existsSync(fileOf(image.url))).toBe(false);
  });

  it('returns 404 for an unknown photo', async () => {
    expect((await api.delete(imagesUrl(product.id, `/${UNKNOWN_ID}`))).status).toBe(404);
  });
});
