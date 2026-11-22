import type { Request, Response } from 'express';
import { getProductBySlug, listCategories, listProducts } from '../services/catalog.service';
import { getPublicStoreSettings } from '../services/settings.service';
import { productListQuerySchema, productSlugSchema } from '../validators/catalog.validators';

export async function categories(_req: Request, res: Response) {
  res.json(await listCategories());
}

export async function products(req: Request, res: Response) {
  res.json(await listProducts(productListQuerySchema.parse(req.query)));
}

export async function product(req: Request, res: Response) {
  const slug = productSlugSchema.parse(req.params.slug);
  res.json({ product: await getProductBySlug(slug) });
}

export async function storeSettings(_req: Request, res: Response) {
  res.json(await getPublicStoreSettings());
}
