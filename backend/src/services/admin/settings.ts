import { prisma } from '../../lib/prisma';
import type { z } from 'zod';
import type {
  deliverySettingsSchema,
  shippingSettingsSchema,
  storeProfileSettingsSchema,
} from '../../validators/admin.validators';
import { getPublicStoreSettings } from '../settings.service';

async function save(key: string, value: Record<string, unknown>, adminId: string) {
  // Keep any keys this form does not manage (for example the currency) instead of overwriting them.
  const existing = await prisma.storeSetting.findUnique({ where: { key } });
  const merged = { ...(existing?.value as Record<string, unknown> | undefined), ...value } as object;
  await prisma.storeSetting.upsert({
    where: { key },
    create: { key, value: merged, updatedById: adminId },
    update: { value: merged, updatedById: adminId },
  });
  return getPublicStoreSettings();
}

export const getSettings = getPublicStoreSettings;

export function saveShipping(input: z.infer<typeof shippingSettingsSchema>, adminId: string) {
  return save('shipping', { flat_fee: input.flatFee, free_above: input.freeAbove }, adminId);
}

export function saveDelivery(input: z.infer<typeof deliverySettingsSchema>, adminId: string) {
  return save('delivery', { min_days: input.minDays, max_days: input.maxDays, production_days: input.productionDays }, adminId);
}

export function saveStoreProfile(input: z.infer<typeof storeProfileSettingsSchema>, adminId: string) {
  return save(
    'store_profile',
    {
      display_name: input.displayName,
      legal_name: input.legalName,
      gstin: input.gstin,
      address: {
        line1: input.address.line1,
        line2: input.address.line2,
        city: input.address.city,
        state: input.address.state,
        postal_code: input.address.postalCode,
        country: input.address.country,
      },
      support_email: input.supportEmail,
      support_phone: input.supportPhone,
    },
    adminId,
  );
}
