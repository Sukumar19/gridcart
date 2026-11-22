import os from 'node:os';
import path from 'node:path';
import { TEST_DB_NAME, testDatabaseUrl } from './test-db';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.AUTH_SECRET = 'test-only-secret-test-only-secret-0123456789';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.PUBLIC_API_URL = 'http://api.test';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'gridcart-test-uploads');

if (new URL(process.env.DATABASE_URL).pathname !== `/${TEST_DB_NAME}`) {
  throw new Error('Refusing to run tests against a database that is not the test database.');
}
