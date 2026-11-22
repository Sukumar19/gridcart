import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { imageStorage } from '../src/lib/storage';
import { prisma } from '../src/lib/prisma';
import { slugify } from '../src/utils/slug';

// Imports local product photos into image storage and links them to products. Skips products that already have images.
// Local storage is for development; before launch a Cloudinary driver replaces it and these photos are re-uploaded.

const PHOTOS_DIR = path.resolve(
  process.env.PRODUCT_PHOTOS_DIR ?? path.resolve(__dirname, '../../assets/OLD-20261121T145039Z-1-001/OLD'),
);
const CSV_PATH = path.resolve(__dirname, '../../assets/product-inventory.csv');
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const MAX_PER_PRODUCT = 10;

function listImages(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...listImages(full));
    else if (IMAGE_EXT.test(entry)) found.push(full);
  }
  return found.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

// The CSV only needs folder -> product name, so a light parser for simple quoted fields is enough.
function readFolderNames(): { folder: string; name: string }[] {
  const text = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const split = (line: string) => [...line.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1]!.replace(/^"|"$/g, '').replace(/""/g, '"'));
  const header = split(headerLine!);
  const col = (name: string) => header.indexOf(name);
  return lines
    .map(split)
    .filter((r) => r[col('include_in_launch')] === 'YES')
    .map((r) => ({ folder: r[col('folder')]!, name: (r[col('product_name')] || r[col('folder')])!.trim() }));
}

async function main() {
  if (!existsSync(PHOTOS_DIR) || !existsSync(CSV_PATH)) {
    console.log(`Nothing to import: photos folder or inventory CSV not found.\n  ${PHOTOS_DIR}\n  ${CSV_PATH}`);
    return;
  }

  let imported = 0;
  let products = 0;
  const problems: string[] = [];

  for (const { folder, name } of readFolderNames()) {
    const product = await prisma.product.findUnique({ where: { slug: slugify(name) }, include: { _count: { select: { images: true } } } });
    if (!product) {
      problems.push(`${folder}: no product with slug "${slugify(name)}"`);
      continue;
    }
    if (product._count.images > 0) continue;

    const dir = path.join(PHOTOS_DIR, folder);
    if (!existsSync(dir)) {
      problems.push(`${folder}: photo folder missing`);
      continue;
    }

    const files = listImages(dir).slice(0, MAX_PER_PRODUCT);
    let order = 0;
    for (const file of files) {
      try {
        const stored = await imageStorage.save({ buffer: readFileSync(file), folder: product.slug, name: path.parse(file).name });
        await prisma.productImage.create({
          data: {
            productId: product.id,
            url: stored.url,
            publicId: stored.publicId,
            width: stored.width,
            height: stored.height,
            isPrimary: order === 0,
            sortOrder: order,
            altText: order === 0 ? product.name : `${product.name}, photo ${order + 1}`,
          },
        });
        order++;
        imported++;
      } catch (err) {
        problems.push(`${folder}/${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (order > 0) products++;
  }

  console.log(`Images: ${imported} imported for ${products} products.`);
  for (const p of problems) console.log(`  problem: ${p}`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
