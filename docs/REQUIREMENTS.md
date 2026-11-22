# GridCart: Requirements (Phase 0)

Status: v1. Database design and UI approach approved 2026-11-22. Updated: 2026-11-22

## 1. Summary

GridCart is an online gift store for customers across India. Shoppers browse gifts, optionally upload their own photo to personalise a product, pay online and track the order. The owner runs the store from an admin dashboard (catalogue, stock, orders, shipping) and never touches the database.

Roles: `CUSTOMER` (guest or registered) and `ADMIN` (owner).

## 2. Confirmed decisions

| Area | Decision | Consequence |
|---|---|---|
| Brand | Gridcart. Colours taken from the logo and the approved UI template: brown `#6C2704`, orange `#FA6903` (brand/graphics only), action orange `#C2410C` (buttons, links), cream `#FCF5EA`, peach `#F8E7D0`, amber `#FDC96A`. Replaces the earlier red/green/cream/yellow palette (changed 2026-11-22). Font: Inter | Design tokens are built from these colours (Phase 2). Brand orange fails contrast with white text, so buttons use the darker action orange |
| Catalogue | Mostly gifts; as many products as the photo folder contains. Development placeholder price is ₹100 per product; real prices come from the owner | Prices are entered in the admin panel. A product cannot go live without a price above 0. Products stay DRAFT until the owner confirms real prices, so the placeholder never goes live |
| Customisation | Customer uploads image(s) only. No text, no live preview, no design-approval step | `design_assets` table, a per-product image limit, private storage for uploads |
| Stock | Per variant: ready stock or made-to-order | `track_inventory` flag per variant |
| Payments | Razorpay, online only. No Cash on Delivery | Simpler order states; no COD fees or return-to-origin handling |
| Tax | GST-registered; listed prices include GST | `gst_rate` and `hsn_code` stored per product; GST is extracted from the price, not added on top |
| Returns | No returns, except damaged, defective or wrong items reported within 48 hours with photos (replacement or refund). Applies to all products | Policy pages; no customer return flow. The admin handles exceptions with a refund or reshipment. Cancellation rule still to decide |
| Delivery | 3 to 5 days. Production time for personalised items not yet given | Product page, checkout and confirmation copy. Confirm whether 3 to 5 days includes making the item |
| Invoices | Automatic PDF GST invoice emailed with every order | `invoices` table is in launch scope (DATABASE.md 5.7). Needs GSTIN and legal name |
| Business | Gridcart, 12/15, Mannappan Lane, Old Washermanpet, Chennai - 600021, Tamil Nadu (state taken from the address; confirm). Legal name, GSTIN, support email and phone still needed | Footer, invoices, policy pages, Razorpay KYC |
| Shipping | India only. Flat fee ₹40 below ₹499, free from ₹499 (the wording "above ₹499" is treated as ₹499 and over). Shipped manually; owner enters the tracking number | Fee and threshold are owner-editable settings (`store_settings`), not code. Seed values: flat_fee 40, free_above 499 |
| Checkout | Guest checkout and registered accounts | Guest carts, nullable `orders.user_id`, emailed tracking link |
| Browsing | Shoppers look for gifts by product type, occasion and recipient | Type in the main menu; occasion and recipient as filters. A product can sit in several categories |
| Gift extras | None at launch: no gift message, gift wrap or scheduled delivery | Simpler checkout. Each address has its own recipient name, so delivery to someone else still works |
| Reviews | After launch | Table sketched in DATABASE.md section 11 |
| Launch catalogue | The 28 products that have photos today. The other 51 folders are added after launch when photos exist | `assets\product-inventory.csv` marks them in the `include_in_launch` column |
| Menu | Approved 2026-11-21. By type: Lamps & lights, Photo frames, Crystal gifts, Roses & flowers, Soft toys & figurines, Anime collectibles, Spiritual & car dashboard, Home & kitchen, Keychains. Filters: occasion (birthday, anniversary, wedding, Valentine's, mother's day), recipient (for her, for him, couples, kids, parents). "Personalised" is a badge and filter, not a category | Seed categories (Phase 4). Occasion and recipient are category groups in the same tree, so the schema is unchanged |

## 3. MVP scope

In scope:

- Customer: home, category and product listing, product detail with variants, search and filters, cart, guest or account checkout, address entry, Razorpay payment, order confirmation, order history and tracking, photo upload on customisable products.
- Admin: secure login, dashboard (orders, revenue, low stock), product, category, variant and image management, stock and price updates, order list and detail, status updates with tracking number, cancellations and refunds.
- Backend: authentication, product, cart and order APIs, server-side price and stock validation, payment verification and webhooks, stock reservation, email notifications.

After launch: coupons, reviews, wishlist, text customisation and live preview, Cash on Delivery, shipping aggregator, WhatsApp/SMS, advanced analytics, recommendations.

## 4. Open questions

None of these block the schema. "Needed by" is the phase where the answer is first used.

| # | Question | Why it matters | Needed by |
|---|---|---|---|
| 1 | Answered: all three (see section 2) | - | - |
| 2 | Answered: none at launch (see section 2) | - | - |
| 3 | Answered: no returns except damaged, defective or wrong items within 48 hours (section 2). Still open: until which status a customer may cancel (proposal: until the owner confirms the order) | Cancel button, refund rules, policy pages (Razorpay reviews these before activation) | Phase 6 |
| 4 | Answered: automatic PDF invoice. Still open: GST on the shipping fee and credit notes for refunds. Confirm with your CA | Invoice numbering, tax lines, refund documents | Phase 6 |
| 5 | Partly answered: address and state (section 2). Still needed: legal name, GSTIN, support email and phone | Footer, invoices, policy pages, Razorpay KYC | Phase 6 |
| 6 | Razorpay account status | Test mode works immediately; live keys need account activation, which takes time. Start early | Start now |
| 7 | Domain name (.com or .in) and a business email address | Deployment and email sender | Phase 9 |
| 8 | Partly answered: delivery 3 to 5 days. Still needed: production time for personalised items | Product page and checkout copy | Phase 5 |
| 9 | Per-product data: name, description, variants (colour, size), photos | Catalogue import | Phase 3 |
| 10 | Upload rules for customer photos: formats, maximum size, minimum resolution | Validation and error messages | Phase 5 |
| 11 | Expected orders per day | Hosting tier and rate limits | Phase 9 |

## 5. Non-functional requirements

- Security: OWASP Top 10 baseline. Prices, stock and payment status are always verified on the server. Argon2id or bcrypt password hashing, HTTPS only, rate limiting, customer uploads stored privately.
- Accessibility: WCAG 2.1 AA. Text contrast at least 4.5:1, touch targets at least 44 px, visible focus states.
- Performance: server-rendered product pages and responsive images through Cloudinary. Target Largest Contentful Paint under 2.5 s on a mid-range phone over 4G.
- SEO: clean slugs, server-rendered catalogue pages, sitemap, social preview tags.
- Devices: mobile-first. Latest two versions of Chrome, Safari (iOS), Edge, Firefox and Samsung Internet.
- Locale: English, INR, Indian addresses (6-digit PIN code).
- Privacy: privacy policy page and a way to delete or anonymise an account on request (India's DPDP Act). Confirm details with a legal adviser.
- Reliability: automated database backups, with a restore test before launch.

## 6. Asset handling

Product photos go in `D:\Project\assets\productPhotos\<product-name>\`, one folder per product, main photo first. They are source files only: excluded from Git and uploaded to Cloudinary by an import script that also creates draft products from a simple spreadsheet (Phase 4).

Recommended: JPG, PNG or WebP, at least 1200 px on the long side, one consistent aspect ratio (for example 4:5 or 1:1), under 5 MB each.

## 7. Needed from you

- [ ] Fill in `assets\product-inventory.csv` for the 28 launch products (type, occasion, recipient, personalised, price, colours, sizes, stock).
- [x] Logo: the circular badge is the master. Transparent icon, wordmark and light and dark horizontal lockups were derived from it in `assets\brand`. An SVG from the original designer would be sharper if one exists.
- [ ] Answers to the open questions in section 4 (1, 2 and 5 first).
- [ ] Razorpay account created and KYC started.
- [ ] Node.js LTS installed (only Git is installed today).
