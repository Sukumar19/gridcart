import type { Prisma } from '../generated/prisma/client';

type Decimalish = Prisma.Decimal | number | string;

// Money travels as a string such as "499.00" so no floating-point rounding can creep in.
export function money(value: Decimalish): string {
  return typeof value === 'object' ? value.toFixed(2) : Number(value).toFixed(2);
}

export function discountPercent(price: Prisma.Decimal, compareAt: Prisma.Decimal | null): number | null {
  if (!compareAt || compareAt.lessThanOrEqualTo(price)) return null;
  return Math.round(compareAt.minus(price).dividedBy(compareAt).times(100).toNumber());
}
