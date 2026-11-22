import { env } from '../../config/env';
import { localStorageDriver } from './local';

export interface StoredImage {
  url: string;
  publicId: string;
  width: number;
  height: number;
}

export interface ImageStorage {
  save(input: { buffer: Buffer; folder: string; name: string }): Promise<StoredImage>;
  remove(publicId: string): Promise<void>;
}

// Swap this one line for a Cloudinary driver when photos move to the cloud.
export const imageStorage: ImageStorage = localStorageDriver;

// Stored URLs are relative for local files ("/media/...") and absolute for a CDN; clients always get an absolute URL.
export function publicUrl(stored: string): string {
  return stored.startsWith('/') ? new URL(stored, env.PUBLIC_API_URL).toString() : stored;
}
