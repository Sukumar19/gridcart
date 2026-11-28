import multer from 'multer';
import { HttpError } from '../utils/http-error';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 8;

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Photos are held in memory only long enough to be checked and re-encoded; nothing is written to disk as uploaded.
// The declared type is only a first filter: the image is verified again by decoding it.
export const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES_PER_REQUEST, fields: 5, parts: MAX_FILES_PER_REQUEST + 5 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new HttpError(415, 'UNSUPPORTED_MEDIA', 'Only JPG, PNG or WebP photos are allowed'));
  },
}).array('images', MAX_FILES_PER_REQUEST);
