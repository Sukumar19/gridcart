import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
import { TEST_DB_NAME, testDatabaseUrl } from './test-db';

// Creates the test database if needed and brings it to the latest migration. Runs once per test run.
export default async function setup() {
  const testUrl = testDatabaseUrl();

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB_NAME]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE ${TEST_DB_NAME} TEMPLATE template0 ENCODING 'UTF8'`);
    }
  } finally {
    await client.end();
  }

  const prismaCli = path.resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}
