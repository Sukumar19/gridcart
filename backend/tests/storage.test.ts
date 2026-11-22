import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { imageStorage, publicUrl } from '../src/lib/storage';

const uploadDir = path.join(os.tmpdir(), 'gridcart-test-uploads');
afterAll(() => rm(uploadDir, { recursive: true, force: true }));

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#fa6903' } }).png().toBuffer();

describe('local image storage', () => {
  it('re-encodes to WebP, shrinks huge photos, and reports the stored size', async () => {
    const stored = await imageStorage.save({ buffer: await png(3200, 2000), folder: 'Heart Lamp', name: 'Pink 1.png' });

    expect(stored.publicId).toMatch(/^heart-lamp\/pink-1-[0-9a-f]{8}\.webp$/);
    expect(stored.url).toBe(`/media/${stored.publicId}`);
    expect(Math.max(stored.width, stored.height)).toBe(1600);
    expect(stored.width / stored.height).toBeCloseTo(1.6, 1);
  });

  it('does not enlarge small photos', async () => {
    const stored = await imageStorage.save({ buffer: await png(400, 300), folder: 'toys', name: 'small' });
    expect([stored.width, stored.height]).toEqual([400, 300]);
  });

  it('rejects files that are not images, even if named like one', async () => {
    await expect(imageStorage.save({ buffer: Buffer.from('<?php echo 1; ?>'), folder: 'x', name: 'evil.png' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_IMAGE',
    });
  });

  it('keeps folder and file names safe (no path traversal)', async () => {
    const stored = await imageStorage.save({ buffer: await png(10, 10), folder: '../../etc', name: '..\\..\\passwd' });
    expect(stored.publicId).not.toContain('..');
    expect(stored.publicId.split('/')).toHaveLength(2);
  });

  it('serves stored photos publicly under /media with a cross-origin header, and refuses to read outside the folder', async () => {
    const app = createApp();
    const stored = await imageStorage.save({ buffer: await png(50, 50), folder: 'serve-test', name: 'a' });

    const ok = await request(app).get(stored.url);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/webp');
    expect(ok.headers['cross-origin-resource-policy']).toBe('cross-origin');

    expect((await request(app).get('/media/../package.json')).status).toBe(404);
    expect((await request(app).get('/media/%2e%2e/package.json')).status).not.toBe(200);
    expect((await request(app).get('/media/serve-test/')).status).toBe(404);
  });

  it('removes files, and ignores paths that escape the upload folder', async () => {
    const app = createApp();
    const stored = await imageStorage.save({ buffer: await png(20, 20), folder: 'remove-test', name: 'b' });
    await imageStorage.remove(stored.publicId);
    expect((await request(app).get(stored.url)).status).toBe(404);
    await expect(imageStorage.remove('../../package.json')).resolves.toBeUndefined();
  });
});

describe('publicUrl', () => {
  it('makes local paths absolute and leaves CDN URLs alone', () => {
    expect(publicUrl('/media/a/b.webp')).toBe('http://api.test/media/a/b.webp');
    expect(publicUrl('https://res.cloudinary.com/x/y.jpg')).toBe('https://res.cloudinary.com/x/y.jpg');
  });
});
