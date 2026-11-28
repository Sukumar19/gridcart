import { prisma } from '../../lib/prisma';
import { imageStorage } from '../../lib/storage';
import { HttpError } from '../../utils/http-error';
import type { ImageUpdateInput } from '../../validators/admin.validators';
import { imageDto, imageOrder } from './dto';
import { notFound } from './shared';

export const MAX_IMAGES_PER_PRODUCT = 12;

async function removeFilesQuietly(publicIds: string[]) {
  await Promise.all(publicIds.map((id) => imageStorage.remove(id).catch(() => undefined)));
}

async function listImages(productId: string) {
  const rows = await prisma.productImage.findMany({ where: { productId }, orderBy: imageOrder });
  return { images: rows.map(imageDto) };
}

export async function addImages(productId: string, files: { buffer: Buffer; originalname: string }[]) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { slug: true, _count: { select: { images: true } } },
  });
  if (!product) throw notFound('Product');
  if (files.length === 0) throw new HttpError(400, 'NO_FILES', 'Choose at least one photo to upload');
  if (product._count.images + files.length > MAX_IMAGES_PER_PRODUCT) {
    throw new HttpError(409, 'TOO_MANY_IMAGES', `A product can have at most ${MAX_IMAGES_PER_PRODUCT} photos`);
  }

  // Validate and store every file first; if any is not a real image, nothing is kept.
  const saved: Awaited<ReturnType<typeof imageStorage.save>>[] = [];
  try {
    for (const file of files) saved.push(await imageStorage.save({ buffer: file.buffer, folder: product.slug, name: file.originalname }));

    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.productImage.findMany({ where: { productId }, select: { isPrimary: true, sortOrder: true } });
      let primaryTaken = existing.some((i) => i.isPrimary);
      let sortOrder = existing.reduce((max, i) => Math.max(max, i.sortOrder), -1);

      const rows = [];
      for (const image of saved) {
        rows.push(
          await tx.productImage.create({
            data: {
              productId,
              url: image.url,
              publicId: image.publicId,
              width: image.width,
              height: image.height,
              isPrimary: !primaryTaken,
              sortOrder: ++sortOrder,
            },
          }),
        );
        primaryTaken = true;
      }
      return rows;
    });
    return { images: created.map(imageDto) };
  } catch (err) {
    await removeFilesQuietly(saved.map((s) => s.publicId));
    throw err;
  }
}

export async function updateImage(productId: string, imageId: string, input: ImageUpdateInput) {
  await prisma.$transaction(async (tx) => {
    const image = await tx.productImage.findFirst({ where: { id: imageId, productId }, select: { id: true } });
    if (!image) throw notFound('Photo');

    if (input.variantId) {
      const variant = await tx.productVariant.findFirst({ where: { id: input.variantId, productId }, select: { id: true } });
      if (!variant) throw new HttpError(400, 'UNKNOWN_VARIANT', 'That variant does not belong to this product');
    }

    if (input.isPrimary) await tx.productImage.updateMany({ where: { productId, isPrimary: true }, data: { isPrimary: false } });

    await tx.productImage.update({
      where: { id: imageId },
      data: {
        ...(input.altText !== undefined && { altText: input.altText }),
        ...(input.variantId !== undefined && { variantId: input.variantId }),
        ...(input.isPrimary && { isPrimary: true }),
      },
    });
  });
  return listImages(productId);
}

export async function reorderImages(productId: string, imageIds: string[]) {
  await prisma.$transaction(async (tx) => {
    const current = await tx.productImage.findMany({ where: { productId }, select: { id: true } });
    const ids = new Set(current.map((i) => i.id));
    if (imageIds.length !== ids.size || new Set(imageIds).size !== ids.size || !imageIds.every((id) => ids.has(id))) {
      throw new HttpError(400, 'IMAGE_SET_MISMATCH', 'The new order must list every photo of this product exactly once');
    }
    for (const [index, id] of imageIds.entries()) await tx.productImage.update({ where: { id }, data: { sortOrder: index } });
  });
  return listImages(productId);
}

export async function deleteImage(productId: string, imageId: string) {
  const removed = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { status: true } });
    if (!product) throw notFound('Product');

    const images = await tx.productImage.findMany({ where: { productId }, orderBy: imageOrder });
    const target = images.find((i) => i.id === imageId);
    if (!target) throw notFound('Photo');

    if (product.status === 'ACTIVE' && images.length === 1) {
      throw new HttpError(409, 'LIVE_PRODUCT_INCOMPLETE', 'A live product needs at least one photo. Unpublish it first or upload another photo before deleting this one.');
    }

    await tx.productImage.delete({ where: { id: imageId } });

    if (target.isPrimary) {
      const next = images.find((i) => i.id !== imageId);
      if (next) await tx.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    return target;
  });

  await removeFilesQuietly([removed.publicId]);
  return listImages(productId);
}
