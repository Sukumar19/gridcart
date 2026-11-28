import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '../../config/env';
import { slugify } from '../../utils/slug';
import { HttpError } from '../../utils/http-error';
import type { ImageStorage, StoredImage } from './index';

const MAX_SIDE = 1600;
const MAX_INPUT_PIXELS = 50_000_000;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export const uploadRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);

// Development storage on local disk. Photos are re-encoded as WebP, which also verifies they are real images.
export const localStorageDriver: ImageStorage = {
  async save({ buffer, folder, name }) {
    let encoded: { data: Buffer; info: sharp.OutputInfo };
    try {
      const image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS });
      // Decide by the real content, not by the file name or declared type: SVG, GIF, TIFF and the like are refused.
      const { format } = await image.metadata();
      if (!format || !ALLOWED_FORMATS.has(format)) throw new Error('unsupported format');

      encoded = await image
        .rotate()
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new HttpError(400, 'INVALID_IMAGE', 'The file is not a valid image');
    }

    const folderSlug = slugify(folder) || 'misc';
    const fileName = `${slugify(path.parse(name).name) || 'image'}-${randomBytes(4).toString('hex')}.webp`;
    const publicId = `${folderSlug}/${fileName}`;

    await mkdir(path.join(uploadRoot, folderSlug), { recursive: true });
    await writeFile(path.join(uploadRoot, publicId), encoded.data);

    const stored: StoredImage = {
      url: `/media/${publicId}`,
      publicId,
      width: encoded.info.width,
      height: encoded.info.height,
    };
    return stored;
  },

  async remove(publicId) {
    const target = path.resolve(uploadRoot, publicId);
    if (!target.startsWith(uploadRoot + path.sep)) return;
    await rm(target, { force: true });
  },
};
