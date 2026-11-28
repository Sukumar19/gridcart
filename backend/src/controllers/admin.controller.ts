import type { Request, Response } from 'express';
import { HttpError } from '../utils/http-error';
import * as categories from '../services/admin/categories';
import * as customers from '../services/admin/customers';
import * as images from '../services/admin/images';
import * as inventory from '../services/admin/inventory';
import * as products from '../services/admin/products';
import * as settings from '../services/admin/settings';
import * as variants from '../services/admin/variants';
import {
  adminProductListQuerySchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  customerListQuerySchema,
  customerUpdateSchema,
  deliverySettingsSchema,
  historyQuerySchema,
  imageOrderSchema,
  imageUpdateSchema,
  inventoryListQuerySchema,
  productCategoriesSchema,
  productCreateSchema,
  productUpdateSchema,
  shippingSettingsSchema,
  stockChangeSchema,
  storeProfileSettingsSchema,
  uuidParam,
  variantCreateSchema,
  variantUpdateSchema,
} from '../validators/admin.validators';

// Admin routes are guarded by requireRole('ADMIN'), so req.auth is always present here.
const adminId = (req: Request): string => {
  if (!req.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
  return req.auth.user.id;
};

const id = (req: Request, name = 'id') => uuidParam.parse(req.params[name]);

// ------------------------------------------------------------ products

export const listProducts = async (req: Request, res: Response) => {
  res.json(await products.listProducts(adminProductListQuerySchema.parse(req.query)));
};
export const getProduct = async (req: Request, res: Response) => {
  res.json(await products.getProduct(id(req)));
};
export const createProduct = async (req: Request, res: Response) => {
  res.status(201).json(await products.createProduct(productCreateSchema.parse(req.body), adminId(req)));
};
export const updateProduct = async (req: Request, res: Response) => {
  res.json(await products.updateProduct(id(req), productUpdateSchema.parse(req.body)));
};
export const setProductCategories = async (req: Request, res: Response) => {
  res.json(await products.setProductCategories(id(req), productCategoriesSchema.parse(req.body).categoryIds));
};
export const publishProduct = async (req: Request, res: Response) => {
  res.json(await products.publishProduct(id(req)));
};
export const unpublishProduct = async (req: Request, res: Response) => {
  res.json(await products.unpublishProduct(id(req)));
};
export const archiveProduct = async (req: Request, res: Response) => {
  res.json(await products.archiveProduct(id(req)));
};
export const restoreProduct = async (req: Request, res: Response) => {
  res.json(await products.restoreProduct(id(req)));
};
export const deleteProduct = async (req: Request, res: Response) => {
  await products.deleteProduct(id(req));
  res.status(204).end();
};

// ------------------------------------------------------------ variants

export const addVariant = async (req: Request, res: Response) => {
  res.status(201).json(await variants.addVariant(id(req), variantCreateSchema.parse(req.body), adminId(req)));
};
export const editVariant = async (req: Request, res: Response) => {
  res.json(await variants.editVariant(id(req), id(req, 'variantId'), variantUpdateSchema.parse(req.body)));
};
export const removeVariant = async (req: Request, res: Response) => {
  await variants.removeVariant(id(req), id(req, 'variantId'));
  res.status(204).end();
};

// ------------------------------------------------------------ images

export const uploadImages = async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  res.status(201).json(await images.addImages(id(req), files));
};
export const updateImage = async (req: Request, res: Response) => {
  res.json(await images.updateImage(id(req), id(req, 'imageId'), imageUpdateSchema.parse(req.body)));
};
export const reorderImages = async (req: Request, res: Response) => {
  res.json(await images.reorderImages(id(req), imageOrderSchema.parse(req.body).imageIds));
};
export const deleteImage = async (req: Request, res: Response) => {
  res.json(await images.deleteImage(id(req), id(req, 'imageId')));
};

// ------------------------------------------------------------ categories

export const listCategories = async (_req: Request, res: Response) => {
  res.json(await categories.listCategories());
};
export const createCategory = async (req: Request, res: Response) => {
  res.status(201).json(await categories.createCategory(categoryCreateSchema.parse(req.body)));
};
export const updateCategory = async (req: Request, res: Response) => {
  res.json(await categories.updateCategory(id(req), categoryUpdateSchema.parse(req.body)));
};
export const deleteCategory = async (req: Request, res: Response) => {
  await categories.deleteCategory(id(req));
  res.status(204).end();
};

// ------------------------------------------------------------ inventory

export const listInventory = async (req: Request, res: Response) => {
  res.json(await inventory.listInventory(inventoryListQuerySchema.parse(req.query)));
};
export const changeStock = async (req: Request, res: Response) => {
  res.json(await inventory.changeStock(id(req, 'variantId'), stockChangeSchema.parse(req.body), adminId(req)));
};
export const stockHistory = async (req: Request, res: Response) => {
  const { page, pageSize } = historyQuerySchema.parse(req.query);
  res.json(await inventory.stockHistory(id(req, 'variantId'), page, pageSize));
};

// ------------------------------------------------------------ customers

export const listCustomers = async (req: Request, res: Response) => {
  res.json(await customers.listCustomers(customerListQuerySchema.parse(req.query)));
};
export const getCustomer = async (req: Request, res: Response) => {
  res.json(await customers.getCustomer(id(req)));
};
export const updateCustomer = async (req: Request, res: Response) => {
  res.json(await customers.setCustomerActive(id(req), customerUpdateSchema.parse(req.body).isActive));
};

// ------------------------------------------------------------ settings

export const getSettings = async (_req: Request, res: Response) => {
  res.json(await settings.getSettings());
};
export const saveShipping = async (req: Request, res: Response) => {
  res.json(await settings.saveShipping(shippingSettingsSchema.parse(req.body), adminId(req)));
};
export const saveDelivery = async (req: Request, res: Response) => {
  res.json(await settings.saveDelivery(deliverySettingsSchema.parse(req.body), adminId(req)));
};
export const saveStoreProfile = async (req: Request, res: Response) => {
  res.json(await settings.saveStoreProfile(storeProfileSettingsSchema.parse(req.body), adminId(req)));
};
