import 'dotenv/config';

export const TEST_DB_NAME = 'gridcart_test';

// Derives the test database URL from the development one; credentials stay in backend/.env.
export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is missing. Create backend/.env first (scripts/setup-db.ps1).');
  const url = new URL(base);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}
