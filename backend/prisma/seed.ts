import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { slugify } from '../src/utils/slug';

// Idempotent: safe to run repeatedly. Existing rows are never overwritten, so owner edits survive.

const GROUPS = [
  { slug: 'type', name: 'Type', sortOrder: 1 },
  { slug: 'occasion', name: 'Occasion', sortOrder: 2 },
  { slug: 'recipient', name: 'Recipient', sortOrder: 3 },
] as const;

const CHILDREN: Record<(typeof GROUPS)[number]['slug'], { slug: string; name: string }[]> = {
  type: [
    { slug: 'lamps-lights', name: 'Lamps & lights' },
    { slug: 'photo-frames', name: 'Photo frames' },
    { slug: 'crystal-gifts', name: 'Crystal gifts' },
    { slug: 'roses-flowers', name: 'Roses & flowers' },
    { slug: 'soft-toys-figurines', name: 'Soft toys & figurines' },
    { slug: 'anime-collectibles', name: 'Anime collectibles' },
    { slug: 'spiritual-car-dashboard', name: 'Spiritual & car dashboard' },
    { slug: 'home-kitchen', name: 'Home & kitchen' },
    { slug: 'keychains', name: 'Keychains' },
  ],
  occasion: [
    { slug: 'birthday', name: 'Birthday' },
    { slug: 'anniversary', name: 'Anniversary' },
    { slug: 'wedding', name: 'Wedding' },
    { slug: 'valentines-day', name: "Valentine's Day" },
    { slug: 'mothers-day', name: "Mother's Day" },
  ],
  recipient: [
    { slug: 'for-her', name: 'For her' },
    { slug: 'for-him', name: 'For him' },
    { slug: 'couples', name: 'Couples' },
    { slug: 'kids', name: 'Kids' },
    { slug: 'parents', name: 'Parents' },
  ],
};

const PLACEHOLDER_PRICE = '100.00';
const PLACEHOLDER_STOCK = 10;

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...data] = rows;
  if (!header) return [];
  return data
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, idx) => [h.trim(), (r[idx] ?? '').trim()])));
}

async function seedCategories(): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>();

  for (const group of GROUPS) {
    const parent = await prisma.category.upsert({
      where: { slug: group.slug },
      update: {},
      create: { slug: group.slug, name: group.name, sortOrder: group.sortOrder },
    });
    for (const [index, child] of CHILDREN[group.slug].entries()) {
      const row = await prisma.category.upsert({
        where: { slug: child.slug },
        update: {},
        create: { slug: child.slug, name: child.name, parentId: parent.id, sortOrder: index + 1 },
      });
      idByKey.set(key(child.name), row.id);
    }
  }
  return idByKey;
}

async function seedSettings() {
  const settings: Record<string, object> = {
    shipping: { flat_fee: 40, free_above: 499, currency: 'INR' },
    delivery: { min_days: 3, max_days: 5, production_days: null },
    store_profile: {
      display_name: 'Gridcart',
      legal_name: null,
      gstin: null,
      address: {
        line1: '12/15, Mannappan Lane',
        line2: 'Old Washermanpet',
        city: 'Chennai',
        state: 'Tamil Nadu',
        postal_code: '600021',
        country: 'IN',
      },
      support_email: null,
      support_phone: null,
    },
  };
  for (const [settingKey, value] of Object.entries(settings)) {
    await prisma.storeSetting.upsert({ where: { key: settingKey }, update: {}, create: { key: settingKey, value } });
  }
}

async function seedProducts(categoryIds: Map<string, string>) {
  const csvPath = path.resolve(__dirname, '../../assets/product-inventory.csv');
  if (!existsSync(csvPath)) {
    console.log(`Products skipped: ${csvPath} not found (it is not stored in Git).`);
    return;
  }

  const rows = parseCsv(readFileSync(csvPath, 'utf8')).filter((r) => r['include_in_launch'] === 'YES');
  const usedSlugs = new Set<string>();
  const warnings: string[] = [];
  let created = 0;
  let skipped = 0;
  let variantCount = await prisma.productVariant.count();

  for (const r of rows) {
    const name = (r['product_name'] || r['folder'] || '').trim();
    if (!name) continue;

    let slug = slugify(name);
    for (let n = 2; usedSlugs.has(slug); n++) slug = `${slugify(name)}-${n}`;
    usedSlugs.add(slug);

    if (await prisma.product.findUnique({ where: { slug } })) {
      skipped++;
      continue;
    }

    const wanted = [r['type'] || r['type_guess'], r['occasion'], r['recipient']]
      .flatMap((v) => (v ? v.split(/[;|,]/) : []))
      .map((v) => v.trim())
      .filter(Boolean);
    const categoryList: string[] = [];
    for (const label of wanted) {
      const id = categoryIds.get(key(label));
      if (id) categoryList.push(id);
      else warnings.push(`${name}: category "${label}" not found`);
    }

    const price = r['price_inr'] && Number(r['price_inr']) > 0 ? Number(r['price_inr']).toFixed(2) : PLACEHOLDER_PRICE;
    const madeToOrder = /made/i.test(r['ready_stock_or_made_to_order'] ?? '');

    let sku = '';
    do sku = `GC-${String(++variantCount).padStart(4, '0')}`;
    while (await prisma.productVariant.findUnique({ where: { sku } }));

    await prisma.product.create({
      data: {
        name,
        slug,
        status: 'DRAFT',
        isCustomizable: /^y/i.test(r['personalised_Y_N'] ?? ''),
        categories: { create: [...new Set(categoryList)].map((categoryId) => ({ categoryId })) },
        variants: {
          create: {
            sku,
            price,
            isDefault: true,
            trackInventory: !madeToOrder,
            stockQuantity: madeToOrder ? 0 : PLACEHOLDER_STOCK,
          },
        },
      },
    });
    created++;
  }

  console.log(`Products: ${created} created, ${skipped} already existed (all DRAFT, placeholder price ₹${PLACEHOLDER_PRICE}).`);
  for (const w of warnings) console.log(`  warning: ${w}`);
}

async function main() {
  const categoryIds = await seedCategories();
  console.log(`Categories ready: ${GROUPS.length} groups, ${categoryIds.size} children.`);
  await seedSettings();
  console.log('Store settings ready (shipping, delivery, store_profile).');
  await seedProducts(categoryIds);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
