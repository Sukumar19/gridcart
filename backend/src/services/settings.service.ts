import { z } from 'zod';
import { prisma } from '../lib/prisma';

const shippingSchema = z.object({
  flat_fee: z.number().min(0).default(0),
  free_above: z.number().min(0).nullable().default(null),
  currency: z.string().default('INR'),
});

const deliverySchema = z.object({
  min_days: z.number().int().min(0).nullable().default(null),
  max_days: z.number().int().min(0).nullable().default(null),
  production_days: z.number().int().min(0).nullable().default(null),
});

const storeProfileSchema = z.object({
  display_name: z.string().default('Gridcart'),
  legal_name: z.string().nullable().default(null),
  gstin: z.string().nullable().default(null),
  address: z
    .object({
      line1: z.string().default(''),
      line2: z.string().nullable().default(null),
      city: z.string().default(''),
      state: z.string().default(''),
      postal_code: z.string().default(''),
      country: z.string().default('IN'),
    })
    .default({ line1: '', line2: null, city: '', state: '', postal_code: '', country: 'IN' }),
  support_email: z.string().nullable().default(null),
  support_phone: z.string().nullable().default(null),
});

async function readSetting<T extends z.ZodType>(key: string, schema: T): Promise<z.output<T>> {
  const row = await prisma.storeSetting.findUnique({ where: { key } });
  return schema.parse(row?.value ?? {});
}

// Used by checkout later: shipping is always computed on the server from these values.
export async function getShippingSettings() {
  const s = await readSetting('shipping', shippingSchema);
  return { flatFee: s.flat_fee, freeAbove: s.free_above, currency: s.currency };
}

export async function getPublicStoreSettings() {
  const [shipping, delivery, profile] = await Promise.all([
    getShippingSettings(),
    readSetting('delivery', deliverySchema),
    readSetting('store_profile', storeProfileSchema),
  ]);

  return {
    shipping,
    delivery: { minDays: delivery.min_days, maxDays: delivery.max_days, productionDays: delivery.production_days },
    store: {
      displayName: profile.display_name,
      legalName: profile.legal_name,
      gstin: profile.gstin,
      address: {
        line1: profile.address.line1,
        line2: profile.address.line2,
        city: profile.address.city,
        state: profile.address.state,
        postalCode: profile.address.postal_code,
        country: profile.address.country,
      },
      supportEmail: profile.support_email,
      supportPhone: profile.support_phone,
    },
  };
}
