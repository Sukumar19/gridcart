import { createInterface } from 'node:readline/promises';
import { z } from 'zod';
import { hashPassword } from '../src/lib/password';
import { prisma } from '../src/lib/prisma';

const emailSchema = z.string().trim().toLowerCase().max(255).email();
const MIN_PASSWORD_LENGTH = 12;

function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('Run this in an interactive terminal so the password is not echoed.'));
      return;
    }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';

    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stdout.write('\n');
    };

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          finish();
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };

    stdin.on('data', onData);
  });
}

async function main() {
  const resetPassword = process.argv.includes('--reset-password');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const emailAnswer = await rl.question('Admin email: ');
  const nameAnswer = await rl.question('Admin first name [Owner]: ');
  rl.close();

  const email = emailSchema.parse(emailAnswer);
  const firstName = nameAnswer.trim() || 'Owner';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !resetPassword) {
    console.error(`An account with ${email} already exists (role ${existing.role}). Run again with --reset-password to set a new password.`);
    process.exitCode = 1;
    return;
  }

  const password = await askHidden(`Password (at least ${MIN_PASSWORD_LENGTH} characters, not shown): `);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const again = await askHidden('Repeat the password: ');
  if (again !== password) throw new Error('The two passwords do not match.');

  const passwordHash = await hashPassword(password);

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { passwordHash, role: 'ADMIN', isActive: true },
    });
    console.log(`Password reset and admin role confirmed for ${email}.`);
  } else {
    await prisma.user.create({
      data: { email, firstName, passwordHash, role: 'ADMIN', emailVerifiedAt: new Date() },
    });
    console.log(`Admin account created for ${email}.`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
