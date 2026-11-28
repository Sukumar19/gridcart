import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { money } from '../../utils/money';
import type { CustomerListQuery } from '../../validators/admin.validators';
import { notFound } from './shared';

const fullName = (u: { firstName: string; lastName: string | null }) => [u.firstName, u.lastName].filter(Boolean).join(' ');

// Never selects password hashes or any other secret.
const publicFields = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  isActive: true,
  emailVerifiedAt: true,
  createdAt: true,
  lastLoginAt: true,
} satisfies Prisma.UserSelect;

async function paidTotals(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();
  const sums = await prisma.order.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds }, paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
    _sum: { totalAmount: true },
  });
  return new Map(sums.flatMap((s) => (s.userId && s._sum.totalAmount ? [[s.userId, money(s._sum.totalAmount)] as const] : [])));
}

export async function listCustomers(query: CustomerListQuery) {
  const where: Prisma.UserWhereInput = {
    role: 'CUSTOMER',
    ...(query.status && { isActive: query.status === 'active' }),
    ...(query.q && {
      OR: [
        { firstName: { contains: query.q, mode: 'insensitive' } },
        { lastName: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
        { phone: { contains: query.q } },
      ],
    }),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: { ...publicFields, _count: { select: { orders: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  const totals = await paidTotals(users.map((u) => u.id));

  return {
    items: users.map((u) => ({
      id: u.id,
      name: fullName(u),
      email: u.email,
      phone: u.phone,
      isActive: u.isActive,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      orderCount: u._count.orders,
      totalSpent: totals.get(u.id) ?? '0.00',
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getCustomer(id: string) {
  const user = await prisma.user.findFirst({
    where: { id, role: 'CUSTOMER' },
    select: {
      ...publicFields,
      addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] },
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, orderNumber: true, status: true, paymentStatus: true, totalAmount: true, createdAt: true },
      },
      _count: { select: { orders: true } },
    },
  });
  if (!user) throw notFound('Customer');
  const totals = await paidTotals([id]);

  return {
    customer: {
      id: user.id,
      name: fullName(user),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      isActive: user.isActive,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      orderCount: user._count.orders,
      totalSpent: totals.get(id) ?? '0.00',
      addresses: user.addresses.map((a) => ({
        id: a.id,
        label: a.label,
        recipientName: a.recipientName,
        phone: a.phone,
        line1: a.line1,
        line2: a.line2,
        landmark: a.landmark,
        city: a.city,
        state: a.state,
        postalCode: a.postalCode,
        isDefault: a.isDefault,
      })),
      recentOrders: user.orders.map((o) => ({ ...o, totalAmount: money(o.totalAmount) })),
    },
  };
}

// Only customer accounts can be managed here; admin accounts are not reachable through this endpoint.
export async function setCustomerActive(id: string, isActive: boolean) {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id, role: 'CUSTOMER' }, select: { id: true } });
    if (!user) throw notFound('Customer');

    await tx.user.update({ where: { id }, data: { isActive } });
    // A blocked customer is signed out everywhere immediately.
    if (!isActive) await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  return getCustomer(id);
}
