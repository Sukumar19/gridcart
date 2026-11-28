import { Router } from 'express';
import * as admin from '../controllers/admin.controller';
import { requireRole } from '../middleware/auth';
import { productImageUpload } from '../middleware/upload';

export const adminRouter = Router();

// Every route registered below is ADMIN-only; the role is checked on the server, not just hidden in the UI.
adminRouter.use(requireRole('ADMIN'));
// Admin data is private and must never be stored by a browser or CDN cache.
adminRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

adminRouter.get('/ping', (req, res) => {
  res.json({ ok: true, role: req.auth?.user.role });
});

// Products
adminRouter.get('/products', admin.listProducts);
adminRouter.post('/products', admin.createProduct);
adminRouter.get('/products/:id', admin.getProduct);
adminRouter.patch('/products/:id', admin.updateProduct);
adminRouter.delete('/products/:id', admin.deleteProduct);
adminRouter.put('/products/:id/categories', admin.setProductCategories);
adminRouter.post('/products/:id/publish', admin.publishProduct);
adminRouter.post('/products/:id/unpublish', admin.unpublishProduct);
adminRouter.post('/products/:id/archive', admin.archiveProduct);
adminRouter.post('/products/:id/restore', admin.restoreProduct);

// Variants
adminRouter.post('/products/:id/variants', admin.addVariant);
adminRouter.patch('/products/:id/variants/:variantId', admin.editVariant);
adminRouter.delete('/products/:id/variants/:variantId', admin.removeVariant);

// Photos
adminRouter.post('/products/:id/images', productImageUpload, admin.uploadImages);
adminRouter.put('/products/:id/images/order', admin.reorderImages);
adminRouter.patch('/products/:id/images/:imageId', admin.updateImage);
adminRouter.delete('/products/:id/images/:imageId', admin.deleteImage);

// Categories
adminRouter.get('/categories', admin.listCategories);
adminRouter.post('/categories', admin.createCategory);
adminRouter.patch('/categories/:id', admin.updateCategory);
adminRouter.delete('/categories/:id', admin.deleteCategory);

// Inventory
adminRouter.get('/inventory', admin.listInventory);
adminRouter.post('/variants/:variantId/stock', admin.changeStock);
adminRouter.get('/variants/:variantId/stock-history', admin.stockHistory);

// Customers
adminRouter.get('/customers', admin.listCustomers);
adminRouter.get('/customers/:id', admin.getCustomer);
adminRouter.patch('/customers/:id', admin.updateCustomer);

// Settings
adminRouter.get('/settings', admin.getSettings);
adminRouter.put('/settings/shipping', admin.saveShipping);
adminRouter.put('/settings/delivery', admin.saveDelivery);
adminRouter.put('/settings/store', admin.saveStoreProfile);
