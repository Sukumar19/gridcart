import type { Prisma } from '../../generated/prisma/client';
import { HttpError } from '../../utils/http-error';
import type { Db } from './shared';

export const PUBLISH_MESSAGES = {
  NO_ACTIVE_VARIANT: 'Add at least one active variant',
  ZERO_PRICE: 'Every active variant needs a price above 0',
  NO_IMAGE: 'Add at least one photo',
  NO_GST_RATE: 'Set the GST rate',
} as const;

export type PublishIssueCode = keyof typeof PUBLISH_MESSAGES;

export interface ReadinessInput {
  gstRate: Prisma.Decimal | null;
  variants: { isActive: boolean; price: Prisma.Decimal }[];
  imageCount: number;
  hasTypeCategory: boolean;
}

// The single definition of "ready to sell". Blockers stop publishing; warnings are shown but do not.
export function publishReadiness(input: ReadinessInput) {
  const issues: PublishIssueCode[] = [];
  const active = input.variants.filter((v) => v.isActive);

  if (active.length === 0) issues.push('NO_ACTIVE_VARIANT');
  else if (active.some((v) => v.price.lessThanOrEqualTo(0))) issues.push('ZERO_PRICE');
  if (input.imageCount === 0) issues.push('NO_IMAGE');
  if (input.gstRate === null) issues.push('NO_GST_RATE');

  return {
    canPublish: issues.length === 0,
    issues: issues.map((code) => ({ code, message: PUBLISH_MESSAGES[code] })),
    warnings: input.hasTypeCategory ? [] : [{ code: 'NO_TYPE_CATEGORY', message: 'Choose a product type so it appears in the menu' }],
  };
}

export type Readiness = ReturnType<typeof publishReadiness>;

export async function loadReadiness(db: Db, productId: string): Promise<Readiness> {
  const p = await db.product.findUniqueOrThrow({
    where: { id: productId },
    select: {
      gstRate: true,
      variants: { select: { isActive: true, price: true } },
      _count: { select: { images: true } },
      categories: { select: { category: { select: { parent: { select: { slug: true } } } } } },
    },
  });
  return publishReadiness({
    gstRate: p.gstRate,
    variants: p.variants,
    imageCount: p._count.images,
    hasTypeCategory: p.categories.some((c) => c.category.parent?.slug === 'type'),
  });
}

export function explainIssues(readiness: Readiness): string {
  return readiness.issues.map((i) => i.message).join('. ');
}

// Call inside a transaction after any change to a live product; throwing rolls the change back.
export async function assertStillPublishable(db: Db, productId: string): Promise<void> {
  const product = await db.product.findUniqueOrThrow({ where: { id: productId }, select: { status: true } });
  if (product.status !== 'ACTIVE') return;

  const readiness = await loadReadiness(db, productId);
  if (!readiness.canPublish) {
    throw new HttpError(
      409,
      'LIVE_PRODUCT_INCOMPLETE',
      `This product is live, so the change was not saved. ${explainIssues(readiness)}. Unpublish the product first if you need to do this.`,
      readiness.issues,
    );
  }
}
