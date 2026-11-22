import { Router } from 'express';
import { categories, product, products, storeSettings } from '../controllers/catalog.controller';
import { publicCache } from '../middleware/cache';

export const catalogRouter = Router();

catalogRouter.use(publicCache(30));
catalogRouter.get('/categories', categories);
catalogRouter.get('/products', products);
catalogRouter.get('/products/:slug', product);
catalogRouter.get('/store/settings', storeSettings);
