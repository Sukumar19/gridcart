# Gridcart: Project Status and Handoff

Read this first when starting a new session. It is written so someone with no memory of earlier work can continue.
Last updated: 2026-11-28. Check `git log --oneline -15` for the latest commits.

## 0. Resume checklist

1. Read this file, then [REQUIREMENTS.md](REQUIREMENTS.md), [DATABASE.md](DATABASE.md) and [DESIGN.md](DESIGN.md). They are the approved sources of truth.
2. Run `git status` and `git log --oneline -15` in `D:\Project`. Confirm the working tree is clean.
3. Check the toolchain (section 4) and that `backend\.env` exists (section 5). If `.env` is missing, the user must run `backend\scripts\setup-db.ps1` (it asks for the PostgreSQL superuser password in their own terminal).
4. Run the backend tests (`npm.cmd test` in `backend`). All 168 should pass (about 3 minutes) before new work.
5. Continue with the first unfinished item in section 9 (Backlog).

## 1. What the project is

Gridcart is an online gift store for customers across India. Shoppers browse gifts, optionally upload their own photo to personalise a product (lamps, frames and similar), pay online with Razorpay, and track the order. The owner (a non-technical friend of the developer) manages products, stock and orders from an admin dashboard and never touches the database.

- Roles: `CUSTOMER` (guest or registered) and `ADMIN`.
- GitHub: `Sukumar19/gridcart`, a **public** repository (the user's decision). Never commit secrets, uploads, product photos or `.env` files; Git history is permanent.
- The user is the developer and is learning. They want phase-by-phase guidance with the reasoning explained, short answers, no emojis, and no assumptions about business facts (ask instead).

## 2. Decisions already made (details in REQUIREMENTS.md section 2)

| Area | Decision |
|---|---|
| Brand | Gridcart. Colours from the logo and approved template: brown `#6C2704`, cream `#FCF5EA`, peach `#F8E7D0`, brand orange `#FA6903` (graphics only), action orange `#C2410C` (buttons and links), amber `#FDC96A`. Font: Inter. Earlier red/green palette was dropped. |
| Menu | Browse by type (Lamps & lights, Photo frames, Crystal gifts, Roses & flowers, Soft toys & figurines, Anime collectibles, Spiritual & car dashboard, Home & kitchen, Keychains), with occasion and recipient filters. "Personalised" is a badge and filter, not a category. |
| Checkout | Guest checkout and accounts. Razorpay only, no Cash on Delivery. No gift extras (no gift message, wrap or scheduled delivery) at launch. Reviews and wishlist after launch. |
| Money | Prices include GST. `NUMERIC(12,2)` rupees; the API sends money as strings such as `"499.00"`. |
| Shipping | India only. Flat fee Rs 40, free from Rs 499 (treated as 499 and over). Values live in `store_settings`, not in code. |
| Delivery | 3 to 5 days (confirm whether this includes making personalised items). Production time not yet given. |
| Returns | No returns, except damaged, defective or wrong items reported within 48 hours with photos (replacement or refund). The "Easy Returns" claim must not be shown. |
| Invoices | Automatic PDF GST invoice emailed with every order (`invoices` table exists). |
| Business | Gridcart, 12/15 Mannappan Lane, Old Washermanpet, Chennai 600021, Tamil Nadu. Legal name, GSTIN, support email and phone are **still needed**. |
| Catalogue | 28 launch products (the ones with photos). 51 more folders wait for photos. Placeholder price Rs 100 and placeholder stock 10 are for development only; products stay DRAFT until the owner sets real prices. |
| Photos | Kept **local** during development. Everything is uploaded to Cloudinary at the very end. |
| Design approach | Hybrid: the four template screens (home, products, product page, cart) follow the template image; every other screen is specified in DESIGN.md and reviewed in the browser. No full Figma prototypes. |

## 3. Repository layout

```
D:\Project
  README.md, .gitignore, .gitattributes
  docs\            REQUIREMENTS.md, DATABASE.md, DESIGN.md, PROJECT_STATUS.md (this file)
  backend\         Express + TypeScript API
    prisma\        schema.prisma, migrations\ (one init migration), seed.ts
    scripts\       setup-db.ps1, create-admin.ts, import-product-images.ts
    src\           app.ts, server.ts, config\env.ts, lib\, middleware\, services\,
                   controllers\, routes\, validators\, utils\, types\
    tests\         vitest + supertest suites, helpers
    uploads\       local product photos (git-ignored)
  frontend\        Next.js app (currently a placeholder page)
  assets\          product photos, logos, product-inventory.csv (git-ignored)
```

Git ignores: `assets/`, `.env*` (except `.env.example`), `node_modules`, `dist`, `.next`, `backend/uploads/`, `backend/src/generated/`, and a few stray root files.

## 4. Toolchain and how to run things (Windows, PowerShell)

- Node v26.13.1, npm 11.20, Git 2.56, PostgreSQL 17.12 (Windows service `postgresql-x64-17`, port 5432). `psql` is not on PATH: `C:\Program Files\PostgreSQL\17\bin\psql.exe`.
- **PowerShell blocks `npm.ps1`. Always use `npm.cmd` and `npx.cmd`.** Do not change the execution policy.
- Backend (`D:\Project\backend`): `npm.cmd run dev` (port 4000), `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd run db:seed`, `npm.cmd run images:import`, `npm.cmd run admin:create`.
- Frontend (`D:\Project\frontend`): `npm.cmd run dev` (port 3000), `npm.cmd run lint`, `npm.cmd run build`.
- Versions: Express 5.3, TypeScript 7, Prisma 7.10.1 (stay on 7; Prisma 8 is a release candidate), zod 4, argon2, sharp, vitest 5, supertest. Frontend: Next.js 16.4.6, React 19.3, Tailwind 4.3.3. `frontend\AGENTS.md` warns that this Next.js version differs from older ones: read `node_modules/next/dist/docs/` before writing Next.js code.
- VS Code was opened on `D:\Project\frontend` only. Opening `D:\Project` as the workspace makes search tools see the whole project.

## 5. Environment, secrets and accounts

- `backend\.env` is git-ignored and was generated by `scripts\setup-db.ps1`. Keys: `NODE_ENV`, `PORT` (4000), `FRONTEND_URL` (http://localhost:3000), `DATABASE_URL`, `AUTH_SECRET`, optional `PUBLIC_API_URL`, `UPLOAD_DIR`, `SESSION_TTL_DAYS`, `ADMIN_SESSION_TTL_HOURS`, and empty `RAZORPAY_*` and `CLOUDINARY_*` placeholders. See `backend\.env.example`.
- **Never ask the user to paste secrets (passwords, keys, tokens) into chat.** The user types them into their own terminal or edits `.env` themselves. Scripts that need secrets prompt in the user's terminal.
- The local PostgreSQL superuser password is known to the user and must never be written to any file. The app uses its own generated user `gridcart_app`.
- Dev database `gridcart` and test database `gridcart_test` (created and migrated automatically by the tests).
- An ADMIN account already exists in the dev database (created by the user with `admin:create`). To add another admin or reset a password, the user runs `npm.cmd run admin:create` (optionally `-- --reset-password`) in their own terminal.
- GitHub: pushes work as `Sukumar19` (remote URL contains the username). A different saved Windows credential for another GitHub account exists on the PC; do not clear or modify it. Commits use the GitHub no-reply email set in the repo-local Git config. The global Git email is the user's employer address and must not be used here.

## 6. Current state of the database (development)

- 22 categories (groups `type`, `occasion`, `recipient` plus children), 3 `store_settings` rows (`shipping`, `delivery`, `store_profile`), 28 **DRAFT** products each with one default variant (Rs 100.00 placeholder, stock 10), 161 product images, 1 admin user.
- Because every product is DRAFT, the public product and category endpoints return empty lists until products are published. This is expected.
- Nine launch products have no type yet (Amb & Per, Elio Blue, Elio Pink, Happy-Birthday, Mini Guitar Sleep, Moon Love Heart, Sitting Su, The Paradise, Uni With Wings). No product is flagged personalisable yet (the photo lamps `text-heart` and `plugsss` should be). Product names are rough drafts from folder names. All of this is for the owner to fix in the admin panel.
- `gst_rate` and `hsn_code` are empty; publishing must require a GST rate.
- Schema changes go through Prisma migrations. Partial indexes and CHECK constraints are hand-written SQL appended to the init migration (see DATABASE.md sections 7 and 8).

## 7. What is built (backend)

**Authentication** (`/api/auth`): `POST register`, `POST login`, `POST logout`, `GET me`. Plus `GET /api/admin/ping` (ADMIN only).
- Opaque 256-bit session token in an HttpOnly, SameSite=Lax cookie (`gc_session`, or `__Host-gc_session` in production with Secure). Only the SHA-256 hash is stored in `auth_sessions`; sessions are revocable. Customer sessions 14 days, admin sessions 8 hours.
- Argon2id password hashing (`src/lib/password.ts`). Login errors are generic and timing-equalised. The role is always `CUSTOMER` on registration.
- CSRF defence: SameSite cookies plus an Origin check on non-GET requests (`middleware/same-origin.ts`) plus CORS limited to `FRONTEND_URL`. Rate limits on login and registration (`middleware/rate-limit.ts`).
- Error format everywhere: `{ "error": { "code", "message", "details?" } }`. Throw `HttpError(status, code, message)` from services; zod errors become 400 `VALIDATION_ERROR`.
- Request context: `req.auth = { sessionId, user }` (types in `src/types/express.d.ts`). Use `requireAuth` and `requireRole('ADMIN')` from `middleware/auth.ts`.

**Public catalogue** (`/api`, `Cache-Control: public, max-age=30`):
- `GET /categories`: groups with only categories that have ACTIVE products, with counts.
- `GET /products`: search (`q`: substring plus pg_trgm typo tolerance), filters `type`, `occasion`, `recipient` (comma lists; OR within a group, AND across groups), `personalised`, `inStock`, `minPrice`, `maxPrice`; sort `relevance|newest|featured|price_asc|price_desc`; `page`, `pageSize` (max 48). Filtering and sorting happen in memory, which is fine for a few hundred products.
- `GET /products/:slug`: ACTIVE products only. Variants, images, categories, up to 4 related products. Remaining stock is exposed only when at or below the low-stock threshold. GST and HSN are never exposed.
- `GET /store/settings`: shipping, delivery days, public store profile. `getShippingSettings()` in `services/settings.service.ts` is what checkout must use for shipping.
- Prices are strings; `compareAtPrice` and `discountPercent` appear only when the old price is genuinely higher.

**Images**: `src/lib/storage/` has an `ImageStorage` interface and a local-disk driver (sharp: auto-rotate, max 1600 px, WebP quality 82, rejects non-images). `imageStorage` in `storage/index.ts` is the single line to swap for a Cloudinary driver. Files live under `backend/uploads` and are served at `/media/...` with `Cross-Origin-Resource-Policy: cross-origin`. DB rows store a relative URL (`/media/...`) plus `public_id`; `publicUrl()` makes them absolute. Customer personalisation photos must NOT be served from `/media` (they are private).

**Seed and scripts**: `prisma/seed.ts` is idempotent and never overwrites existing rows. `scripts/import-product-images.ts` is idempotent (skips products that already have images).

**Admin API** (`/api/admin`, ADMIN only, `Cache-Control: no-store`; code in `controllers/admin.controller.ts`, `services/admin/*`, `validators/admin.validators.ts`, `routes/admin.routes.ts`). All inputs use `z.strictObject`, so unknown fields are rejected with 400.
- Products: `GET /products` (filters `q` name or SKU, `status`, `type`, `featured`, `personalised`, `incomplete`; `sort`; pagination; `statusCounts`), `POST /products` (always DRAFT, auto slug and SKU `GC-0001`, optional first variant, otherwise a placeholder variant at price 0), `GET|PATCH|DELETE /products/:id`, `PUT /products/:id/categories`, `POST /products/:id/publish|unpublish|archive|restore`. DELETE works only for products never ordered (otherwise 409 `HAS_ORDERS`, archive instead).
- **Publish rule** lives in `services/admin/readiness.ts`: at least one active variant, every active variant priced above 0, at least one photo, and a GST rate (0 is allowed). Publishing fails with 400 `NOT_PUBLISHABLE` and `details` listing the issues. Edits that would break a live product (price 0, last active variant, last photo, clearing GST) are rolled back with 409 `LIVE_PRODUCT_INCOMPLETE`. `readiness` (issues and warnings) is returned with every product so the UI can show a checklist. A missing product type is only a warning.
- Variants: `POST /products/:id/variants`, `PATCH|DELETE /products/:id/variants/:variantId`. Stock cannot be edited here (only through the inventory endpoint). Exactly one default variant is kept automatically. SKU and colour plus size must be unique (409). Cannot delete the last variant or an ordered variant.
- Photos: `POST /products/:id/images` (multipart, field `images`, up to 8 files of 8 MB, JPG, PNG or WebP only; content is verified by decoding, so GIF, SVG and fake extensions are refused; all-or-nothing), `PUT /products/:id/images/order`, `PATCH|DELETE /products/:id/images/:imageId` (alt text, primary, link to a variant). Max 12 per product. Files are deleted with their rows.
- Categories: `GET|POST /categories`, `PATCH|DELETE /categories/:id`. The three groups (type, occasion, recipient) can be renamed but not re-linked, deactivated or deleted. A category with products cannot be deleted (deactivate it).
- Inventory: `GET /inventory` (states `OUT`, `LOW`, `OK`, `MADE_TO_ORDER`; filter `state`, search `q`), `POST /variants/:variantId/stock` (`mode` adjust or set, `reason` RESTOCK, ADJUSTMENT or RETURN, optional note; row-locked, never below zero, writes the ledger row in the same transaction), `GET /variants/:variantId/stock-history`.
- Customers: `GET /customers` (search, status, order count, money spent), `GET /customers/:id`, `PATCH /customers/:id {isActive}` (blocking also revokes all their sessions). Admin accounts are not reachable here.
- Settings: `GET /settings`, `PUT /settings/shipping|delivery|store` (camelCase in, stored snake_case, GSTIN, email, phone and PIN validated).

**Tests**: see section 0 for the current count; roughly 4 minutes in total. They use a separate `gridcart_test` database; `tests/setup-env.ts` refuses to run against any other database, and uploads go to a temp folder. Helpers: `tests/helpers.ts` (`resetDatabase`, `createUser`, `createCategory`, `createCatalogGroups`, `createProduct`, `createImageRow`, `createOrderFor`, `signInAs`). Files: `auth`, `catalog`, `storage`, `admin-products`, `admin-media`, `admin-misc`. Add tests with every new feature.

## 8. What is built (frontend)

Only a scaffold: Next.js app with brand tokens in `app/globals.css` (Tailwind `@theme`: colours `brown`, `cream`, `peach`, `orange`, `action`, `amber`, `ink`, `muted`, `line`, `success`, `danger`; radii `control`, `card`, `section`), Inter font, the light logo in `public/brand`, and a placeholder home page. Lint and build pass. No API client, no cart, no real pages yet.

## 9. Backlog (in recommended order)

Follow the approved specs: screens and behaviour in DESIGN.md, tables and the critical algorithms in DATABASE.md section 9 (place order, confirm payment, cancel or expire, stock change, refund) and section 10 (order state machine).

**Step 1: Admin catalogue API (B1) and admin product screens**
- **Done (2026-11-28): the whole admin API** described in section 7, with tests.
- **Still to do: the admin UI screens** for login, products (list, edit with variants, photos and a publish checklist from `readiness`), categories, inventory, customers and settings (DESIGN.md section 5), so the owner can start entering real data. Original B1 scope, for reference:
- ADMIN-only routes under `/api/admin` (all writes already covered by the Origin check).
- Products: list with filters, create, edit, archive (never delete products that have order history). Fields: name, slug, description, status, featured, customisation (is_customizable, max_custom_images 1 to 10, note), HSN, GST rate, categories.
- Variants: create, edit, deactivate (sku, colour with hex, size, price, compare-at price, track inventory, stock, low-stock threshold, default).
- Images: multipart upload (use memory storage, size limit about 5 to 10 MB, JPEG, PNG or WebP only, validate with sharp through `imageStorage.save`), reorder, set primary, edit alt text, delete (also remove the file), optional link to a variant.
- **Publish rule** (service layer): at least one active variant with price above 0, at least one image, and a GST rate. Otherwise 400 with a clear message.
- Categories: create, edit, reorder, deactivate (not delete when products are attached).
- Inventory: list variants with stock, adjust stock with a reason, every change writes an `inventory_transactions` row (`ADJUSTMENT`) in the same transaction.
- Customers list (read-only) and settings update (`store_settings`, validated with zod).
- Then the admin UI screens for products, categories and inventory (DESIGN.md section 5), so the owner can start entering real data.

**Step 2: Storefront (F1, F2)**: header, footer and mobile drawer from the template; reusable components; API client and cart state; home, shop with filters and sort, category pages, search, product page (gallery, variants, uploader). Remove ratings, wishlist and unverifiable claims from the template (DESIGN.md section 2). Configure `next.config.ts` `images.remotePatterns` for `localhost:4000/media`.

**Step 3: Cart, checkout and payments (B2, B4, B5, F3)**
- Cart: guest cart via random cookie (hash stored in `carts.guest_token_hash`), user cart, merge at login, price never stored on cart items, quantity 1 to 50, personalised lines with private `design_assets`. Endpoints `GET /api/cart`, `POST /api/cart/items`, `PUT` and `DELETE /api/cart/items/:id`.
- Checkout: server computes subtotal, shipping (from settings), GST portion (price x rate / (100 + rate) per line) and total. Stock reserved in a transaction (`UPDATE ... WHERE stock_quantity >= qty`, variants sorted by id), order `PENDING_PAYMENT` with `expires_at` about 30 minutes, snapshots of product, price and address, status history, `RESERVED` ledger rows, order number `GC-1001` upward, guest tracking token (hash stored).
- Razorpay: create order (amount in paise), verify signature on the server, webhook with signature check, idempotency via `payment_webhook_events` (unique provider and event id), failed and abandoned payments, late payments, refunds. The user must put Razorpay **test** keys into `.env`. Never trust the browser's success message.
- Expiry job releases stock for unpaid orders after asking Razorpay for the payment state.

**Step 4: Order management and notifications (B6, B7)**: admin order list and detail, allowed status transitions only, shipments with tracking number, cancel and refund, dashboard and sales numbers. Emails (order, payment, shipped, delivered, refund) and the automatic PDF GST invoice (number `GC/2026-27/0001`, financial year April to March, taken under a lock; CGST plus SGST if the delivery state is Tamil Nadu, otherwise IGST). An email provider (Resend or Brevo, to be chosen with the user) and domain DNS are needed.

**Step 5: Accounts and remaining pages (B3, F4, F6)**: forgot and reset password and email verification (use `one_time_tokens`), address book, profile, change password, account deletion request, my orders, order details, guest tracking page, About, Contact, Shipping, Returns and refunds, Privacy, Terms (Razorpay reviews these), 404 and error pages.

**Step 6: Hardening and QA (B8)**: clean-up jobs (expire unpaid orders, orphan design assets older than 24 hours, idle guest carts after 30 days, expired sessions and tokens), Sentry, `docs/API.md`, end-to-end tests of full purchases (Playwright against Razorpay test mode), mobile, tablet and desktop checks, accessibility (WCAG 2.1 AA) and performance (LCP under 2.5 s on mid-range phones), dependency audit.

**Step 7: Deployment and launch**
- Frontend on Vercel, API on Render or Railway, database on Neon or Supabase. Use **one custom domain with subdomains** (for example `gridcart.shop` and `api.gridcart.shop`) so SameSite=Lax cookies work.
- Set production environment variables on the hosts; run `prisma migrate deploy`; seed only categories and settings (no placeholder prices); owner enters real prices and publishes.
- Migrate photos to Cloudinary: add a Cloudinary `ImageStorage` driver, switch the one line in `storage/index.ts`, run a script that re-uploads from `assets` and rewrites `product_images` URLs and public IDs.
- Razorpay live keys after KYC activation, webhook URL, backups with a restore test, HTTPS, monitoring, final production test purchase.

## 10. Still needed from the user or owner

- Real prices, GST rates and HSN codes per product; fix the nine uncategorised products; flag personalisable products; photos for the 51 products that have none; real product names.
- Legal business name, GSTIN, support email and phone.
- Production time for personalised items; confirm 3 to 5 days delivery includes making them.
- Cancellation rule (proposal: customer may cancel until the owner confirms the order).
- Customer photo limits (proposed default: JPG, PNG or WebP, 10 MB each, warn below 1000 px on the long side).
- Confirm with a CA: GST on the shipping fee, and whether refunds need credit notes at launch.
- Razorpay: a business account in the owner's name with KYC started (the `razorpay.me` link the user shared is only a payment page, not API access). Test keys go into `.env` by the user.
- An email sending service and DNS access; Vercel, Render and Neon accounts; Cloudinary account at the end.
- Logo: only a raster badge exists; an SVG from the designer would be sharper.

## 11. Gotchas learned the hard way

- **Prisma `migrate dev` is interactive** when it finds schema differences; a stray typed line becomes the migration name. Always use `--create-only --name something`. Migration folder names over about 200 characters break Windows paths (use the `\\?\` prefix to read or delete).
- **Prisma drops indexes it does not know about.** Any index Prisma can express (for example the trigram GIN index on `products.name`) must also be declared in `schema.prisma`.
- **Prisma blocks `migrate reset` for AI agents** and requires the user's explicit consent text in `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`. Do not run it without asking the user and explaining that it destroys all data. Prefer targeted fixes.
- `npm audit` flags `effect` inside Prisma's config loader. `package.json` has an override (`effect ^3.22.5`); never run `npm audit fix --force` (it downgrades Prisma).
- `vitest.config` must be `.mts`. Test files are not type-checked by `npm run typecheck` (it only covers `src`).
- `src/generated/prisma` is git-ignored and rebuilt by `prisma generate` (runs on `postinstall`).
- Order numbers use an `Int` serial restarted at 1001 (not `bigint`, to avoid BigInt in JSON).
- Express 5: async handlers and thrown errors reach the error handler automatically.
- Terminal quirks in the agent environment: long commands are best run in async mode and polled; the first line of a command is sometimes mangled, so begin with a throwaway line; `psql` needs `-P pager=off`; never leave a command waiting on a password prompt.

## 12. Working agreements

- Explain the reasoning behind decisions; ask when business information is missing; do not invent facts.
- Confirm before destructive actions (deleting files, force operations, data resets) and before pushing code.
- Before every push to the public repo: list changed files and check that no secrets, `.env`, uploads, photos or build output are included.
- Write tests with each feature, keep the suite green, and keep `docs/` and this file updated at the end of each step.
- Security rules: validate all input on the server, never trust prices, totals, stock or payment status from the browser, enforce roles on the server, keep money exact, and keep secrets only in environment variables.
