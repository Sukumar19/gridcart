import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/http-error';
import { slugify } from '../../utils/slug';
import type { CategoryCreateInput, CategoryUpdateInput } from '../../validators/admin.validators';
import { isUniqueViolation, notFound, uniqueSlug } from './shared';

const row = (c: { id: string; slug: string; name: string; description: string | null; sortOrder: number; isActive: boolean; _count: { products: number } }) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  description: c.description,
  sortOrder: c.sortOrder,
  isActive: c.isActive,
  productCount: c._count.products,
});

// Includes inactive categories and counts products of every status, unlike the public list.
export async function listCategories() {
  const rows = await prisma.category.findMany({
    include: { _count: { select: { products: true } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return {
    groups: rows
      .filter((g) => g.parentId === null)
      .map((group) => ({
        ...row(group),
        categories: rows.filter((c) => c.parentId === group.id).map(row),
      })),
  };
}

const slugTaken = async (candidate: string) => (await prisma.category.count({ where: { slug: candidate } })) > 0;

export async function createCategory(input: CategoryCreateInput) {
  const parent = await prisma.category.findUnique({ where: { id: input.parentId }, select: { id: true, parentId: true } });
  if (!parent) throw new HttpError(400, 'UNKNOWN_PARENT', 'The chosen group does not exist');
  if (parent.parentId !== null) throw new HttpError(400, 'NOT_A_GROUP', 'Categories can only be created inside Type, Occasion or Recipient');

  let slug: string;
  if (input.slug) {
    if (await slugTaken(input.slug)) throw new HttpError(409, 'SLUG_TAKEN', 'Another category already uses this link');
    slug = input.slug;
  } else {
    slug = await uniqueSlug(slugTaken, slugify(input.name), 'category');
  }

  const sortOrder =
    input.sortOrder ??
    ((await prisma.category.aggregate({ where: { parentId: parent.id }, _max: { sortOrder: true } }))._max.sortOrder ?? 0) + 1;

  try {
    const created = await prisma.category.create({
      data: {
        parentId: parent.id,
        name: input.name,
        slug,
        description: input.description ?? null,
        sortOrder,
        isActive: input.isActive ?? true,
      },
      include: { _count: { select: { products: true } } },
    });
    return { category: row(created) };
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'SLUG_TAKEN', 'Another category already uses this link');
    throw err;
  }
}

export async function updateCategory(id: string, input: CategoryUpdateInput) {
  const current = await prisma.category.findUnique({ where: { id }, select: { id: true, parentId: true } });
  if (!current) throw notFound('Category');

  // The storefront filters rely on the three groups, so their link and visibility are fixed.
  if (current.parentId === null && (input.slug !== undefined || input.isActive !== undefined)) {
    throw new HttpError(409, 'GROUP_LOCKED', 'Type, Occasion and Recipient are fixed. You can rename them or change their order only.');
  }

  if (input.slug) {
    const owner = await prisma.category.findUnique({ where: { slug: input.slug }, select: { id: true } });
    if (owner && owner.id !== id) throw new HttpError(409, 'SLUG_TAKEN', 'Another category already uses this link');
  }

  try {
    const updated = await prisma.category.update({ where: { id }, data: input, include: { _count: { select: { products: true } } } });
    return { category: row(updated) };
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'SLUG_TAKEN', 'Another category already uses this link');
    throw err;
  }
}

export async function deleteCategory(id: string) {
  const category = await prisma.category.findUnique({
    where: { id },
    select: { parentId: true, _count: { select: { products: true } } },
  });
  if (!category) throw notFound('Category');

  if (category.parentId === null) throw new HttpError(409, 'GROUP_LOCKED', 'Type, Occasion and Recipient cannot be deleted');
  if (category._count.products > 0) {
    throw new HttpError(409, 'CATEGORY_IN_USE', 'Products are still assigned to this category. Deactivate it instead, or move the products first.');
  }
  await prisma.category.delete({ where: { id } });
}
