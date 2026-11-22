import { z } from 'zod';

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'iloveyou',
  '11111111',
  'abc12345',
  'welcome1',
  'gridcart1',
  'gridcart123',
]);

export function normaliseIndianPhone(raw: string): string | null {
  const compact = raw.replace(/[\s()-]/g, '');
  const match = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(compact);
  return match ? `+91${match[1]}` : null;
}

export const emailSchema = z.string().trim().toLowerCase().max(255).email('Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'That password is too common');

const phoneSchema = z
  .string()
  .trim()
  .refine((v) => normaliseIndianPhone(v) !== null, 'Enter a valid 10-digit Indian mobile number')
  .transform((v) => normaliseIndianPhone(v) as string);

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Enter your first name').max(80),
    lastName: z.string().trim().max(80).optional(),
    email: emailSchema,
    password: passwordSchema,
    phone: phoneSchema.optional(),
  })
  .refine((d) => d.password.toLowerCase() !== d.email, {
    path: ['password'],
    message: 'Password must not be your email address',
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
