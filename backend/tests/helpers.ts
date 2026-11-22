import { hashPassword } from '../src/lib/password';
import { prisma } from '../src/lib/prisma';

export const TEST_PASSWORD = 'Sup3r-secret-pass';

// Safe because tests/setup-env.ts guarantees we are connected to the test database.
export async function resetDatabase() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users", "store_settings" RESTART IDENTITY CASCADE');
}

export async function createUser(overrides: { email?: string; role?: 'CUSTOMER' | 'ADMIN'; isActive?: boolean } = {}) {
  return prisma.user.create({
    data: {
      firstName: 'Test',
      email: overrides.email ?? 'user@example.com',
      passwordHash: await hashPassword(TEST_PASSWORD),
      role: overrides.role ?? 'CUSTOMER',
      isActive: overrides.isActive ?? true,
    },
  });
}

export async function closeDatabase() {
  await prisma.$disconnect();
}
