# Gridcart: UI Design (Phase 2)

Status: v1 for review, 2026-11-22. Approach: hybrid. The four template screens (home, products, product page, cart) follow the template image. Every other screen is specified here and reviewed as a working site in the browser. Inputs: [REQUIREMENTS.md](REQUIREMENTS.md), [DATABASE.md](DATABASE.md), the template image, and the logo files in `assets\brand`.

## 1. Foundations

### Colours

| Token | Hex | Use |
|---|---|---|
| `brown` | 6C2704 | Header, footer, headings, focus ring |
| `cream` | FCF5EA | Page background |
| `peach` | F8E7D0 | Tiles, strips, progress track |
| `white` | FFFFFF | Cards, inputs |
| `orange` | FA6903 | Logo, illustrations, progress fill. Never text, never a white-text button |
| `action` | C2410C | Primary buttons, links, highlighted words. Hover A8360A, pressed 8C2C08 |
| `amber` | FDC96A | Badges with brown text |
| `ink` | 2A1708 | Body text |
| `muted` | 6B5646 | Secondary text |
| `border` | 8A6F5A | Input borders |
| `success` / `error` | 1B6B3A / B42318 | Status text, on tints E6F4EA and FDECEA |
| `warning tint` | FFF1CC | Warning banners, brown text |

Contrast checked: white on action 5.18, cream on brown 10.05, brown on cream 10.05, brown on amber 7.12, action on cream 4.78, muted on cream 6.37. Status is never shown by colour alone: always an icon and text.

### Type, shape, layout

- Font: Inter. Display 800, headings 700, labels 600, body 400.
- Scale (mobile to desktop, size/line): Display 36/44 to 56/64, H1 30/38 to 40/48, H2 24/32 to 32/40, H3 20/28 to 24/32, Body 16/24, Small 14/20, Caption 12/16 (non-essential only).
- Spacing: 4, 8, 12, 16, 24, 32, 48, 64, 96.
- Radius: buttons and inputs 12, images 16, cards 20, sections 32, search and chips fully round.
- Shadows: small `0 1px 2px` and medium `0 6px 16px`, brown at 8 to 10 percent.
- Focus ring: 3 px brown with a 2 px gap. Touch targets at least 44 px. Buttons 48 px tall.
- Review sizes: mobile 390, tablet 768, desktop 1440. Tailwind breakpoints `md` 768 and `xl` 1280. Container max 1280. Product grid: 2, 3, 4 columns.

### Components

Button (primary action, secondary brown outline, text link; states default, hover, pressed, focus, disabled, loading), input, select, textarea (with help and error text), quantity stepper, filter chip, badge (Personalised, Sale, Low stock, Sold out), product card, header, footer, breadcrumb, toast, modal and bottom sheet, skeleton, empty state, error state, photo uploader, status chip, order timeline, price summary.

Buttons: product cards use brown fill; the product page and cart use action orange for the main action and brown outline for secondary.

## 2. Changes to the template

- Navigation labels: Home, Shop, Collections (types that have products), Occasions, About Us, Contact. Recipient appears as a filter and a homepage row.
- Sidebar categories become the approved types. Add occasion, recipient, Personalised, and in-stock filters. Sort: Newest, Price low to high, Price high to low, Featured. No "Popularity" until sales data exists.
- Remove at launch: star ratings, review counts, wishlist heart, "Trusted by Millions", "12,500+ reviews", "24/7 Support".
- Remove "Easy Returns". The policy is no returns except damaged, defective or wrong items reported within 48 hours.
- Discount badge and struck-through MRP only when `compare_at_price` is a genuine earlier price.
- Add the photo uploader to the product page and photo thumbnails to the cart.
- Headline accent word uses `action`, not bright orange.
- Hero and tiles use real product photos. Free-shipping amounts come from owner settings, not the template's numbers.

## 3. Global patterns

- **Header:** brown with a curved bottom edge. Desktop: `logo-horizontal-light`, nav, search pill, account, cart with count. Mobile: hamburger, centred logo, search, cart. The drawer lists the types, occasions, account links, and Sign in and Sign up buttons. Sticky on scroll.
- **Footer:** brown, cream text. Columns: Shop (types), Help (shipping, returns and refunds, track order, contact), Company (about, privacy, terms). Business details from settings: legal name, GSTIN, address, support email and phone. Line: "Secure payments by Razorpay".
- **Prices:** Indian grouping (`₹1,299`). Label "Inclusive of all taxes". Cart and checkout show the GST portion.
- **Personalisation:** products with `is_customizable` show an uploader card. Dropzone or camera on mobile, up to `max_custom_images` photos, thumbnails with remove, per-file progress and errors. The add-to-cart button stays disabled until the required photos are uploaded. Text: the product's `customization_note`, plus "Your photos are used only to make your order". Proposed limits (owner to confirm): JPG, PNG, WebP, 10 MB each, warn below 1000 px on the long side.
- **Made to order:** variants with `track_inventory = false` show "Made to order: ready in X days" instead of stock.
- **Order status labels:** Awaiting payment, Payment failed, Payment received, Confirmed, Packed, Shipped, Delivered, Cancelled, Refund in progress, Refunded. Customer timeline: Placed, Paid, Confirmed, Packed, Shipped, Delivered.
- **States for every screen:** skeleton while loading, empty state with one clear action, error state with Retry, inline field errors linked to the field. Toasts announce cart and save results to screen readers.
- **Accessibility:** WCAG 2.1 AA, keyboard-operable menus and dialogs, visible focus, alt text on all product images, respect reduced motion.
- **Routes:** `/`, `/products`, `/category/[slug]`, `/product/[slug]`, `/search`, `/cart`, `/checkout`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/account`, `/account/addresses`, `/account/orders`, `/account/orders/[id]`, `/track/[token]` (guest), `/admin/...`.

## 4. Customer screens

Mobile first; the desktop notes say what changes.

**Home `/`** (template). Hero with headline, short line, and "Explore collection". Benefits strip with true claims only: made-to-order personalised gifts, secure payments, free shipping above the threshold, delivery across India. Collection tiles (types with products). Rows for occasion and recipient. Featured products (`is_featured`). Three-step "How personalising works": choose, upload your photo, we make and ship.

**Products `/products`** (template). Banner, breadcrumb, sidebar filters (desktop) or Filters button opening a bottom sheet (mobile), sort control, product grid, active filter chips with "Clear all", pagination. Filters live in the URL so links can be shared. Empty state: "No gifts match", with a clear-filters button.

**Category `/category/[slug]`.** Same as Products with a banner showing the category name, description and image, and the filter preset.

**Product `/product/[slug]`** (template). Gallery (thumbnails on desktop, swipe on mobile), name, price with optional MRP and percent off, bullets, colour swatches (`color_hex`) and size chips (sold-out options disabled), quantity, uploader if personalised, Add to cart, Buy now, production and delivery note, details and shipping accordions, related products from the same type. Mobile: sticky bottom bar with price and Add to cart. Sold out: disabled button labelled "Sold out".

**Search `/search?q=`.** Header search with a suggestions dropdown (top five product names). Results use the Products layout with "Results for 'q'" and a count. Typo tolerant. No results: suggestions and the type tiles.

**Cart `/cart`** (template). Lines: image, name, variant, photo thumbnails with "Edit photos", quantity, remove, line total. Free-shipping bar ("You are ₹X away from free shipping" or "You've got free shipping"). Summary: subtotal, shipping, total, GST included. Warnings in place: "Only 2 left", "No longer available" (offer Remove). Empty state: "Your cart is empty" and Browse gifts. Persists for guests.

**Login `/login`.** Card on cream: email, password with show and hide, Forgot password link, Sign in, link to Register. Error text is generic: "Email or password is incorrect". Handles the rate-limit message. Returns to the page the user came from.

**Register `/register`.** First name, last name, email, password (minimum 8 characters, strength hint), terms and privacy checkbox. Phone is collected at checkout. Verification email is sent but does not block buying.

**Forgot and reset password.** One field for email, then a reset form from the emailed link. Same confirmation message whether or not the email exists.

**Addresses `/account/addresses`.** Address cards (label, recipient, address, phone, Default badge) with Edit, Delete (confirm), Set default. Form: recipient name, phone (+91, 10 digits), line 1, line 2, landmark, city, state (list of Indian states), PIN (6 digits), label chips Home, Work, Other, default checkbox. Add and Edit open as a bottom sheet on mobile and a modal on desktop.

**Checkout `/checkout`.** One page. Mobile: stacked sections with a summary on top that collapses. Desktop: form left, sticky summary right. Sections: 1 Contact (email, phone; guests continue, others sign in), 2 Delivery address (saved addresses or new form; the recipient name allows delivery to someone else), 3 Review and pay (items with photo thumbnails, shipping, total, optional order note, policy agreement). "Pay ₹X" opens Razorpay. Stock and prices are re-checked on the server when paying; changes show in a banner.

**Payment.** Card, UPI and netbanking happen inside Razorpay's own window; the site never sees card details. Our screen `/checkout/processing` says "Confirming your payment…" and waits for the server to confirm (never trusts the browser alone). Failure or cancel: "Payment didn't go through", with Try again (same order, valid 30 minutes) and Back to cart.

**Confirmation `/orders/[id]/confirmed`.** Success card, order number (`GC-1042`), items, address, expected dispatch from production time, "We emailed you at …", buttons Track order and Continue shopping. Guests also see their tracking link.

**My orders `/account/orders`.** Order cards: number, date, status chip, item thumbnails, total, View details. Empty state: "No orders yet". Pagination.

**Order details `/account/orders/[id]` and `/track/[token]`.** Header with number, date and status chip. Timeline. Items with personalised photos. Price breakdown. Payment status and method. Delivery address. Shipment block (carrier, tracking number, tracking link). Actions: Cancel order (only while the policy allows), Download invoice (PDF), Contact support. Cancelled and refunded orders show the refund line instead of the timeline end.

**Profile `/account`.** Name, phone, email (read-only), change password, links to addresses and orders, "Request account deletion", Sign out. Mobile: menu list.

**Static pages.** About, Contact (form and business details), Shipping, Returns and refunds, Privacy, Terms. Plain readable layout, owner-written text. Razorpay reviews these before going live.

**System pages.** 404, 500, maintenance. Each has a link home.

## 5. Admin screens

Own layout, same tokens, denser. Desktop: brown sidebar and top bar with the user menu. Mobile: drawer. Tables become stacked cards below 768 px. Every admin API call is checked for the ADMIN role on the server.

**Login `/admin/login`.** Email and password only, generic errors, rate limited, no sign-up link.

**Dashboard.** Cards: orders today and this month, revenue (paid minus refunds) with a date range, "Needs action" counts (to confirm, to pack, to ship), low-stock list, five recent orders, 30-day revenue chart.

**Products.** Table: thumbnail, name, types, price range, total stock, status chip (Draft, Active, Archived), Personalised badge. Search, filters (status, type, low stock), Add product. "Delete" means Archive, because sold products keep order history.

**Add and edit product.** Sections: Basics (name, auto slug, description); Categories (type, occasion, recipient); Personalisation (toggle, max photos, note); Variants table (SKU, colour with swatch, size, price, MRP, track inventory, stock, low-stock threshold, default, active); Images (multi upload, drag to reorder, set main, alt text, link to a variant); Tax (HSN, GST rate); Status. A publish checklist shows what is missing (active variant with a price above 0, a photo, a GST rate). Warns before leaving with unsaved changes.

**Categories.** Three groups: Type, Occasion, Recipient. Add and edit (name, slug, description, image, order, active). Drag to reorder. A category with products can be deactivated, not deleted.

**Inventory.** One row per variant: product, SKU, colour and size, tracked or made to order, stock, threshold, status chip (Low, Out). Edit stock inline with a reason; every change is written to the stock ledger. History drawer shows the ledger.

**Orders.** Tabs: Needs action, Shipped, Delivered, Cancelled and refunds, All. Columns: number, date, customer, items, total, payment status, status chip. Search by number, email or phone. Date range.

**Order details.** Header with status and one primary next-step button (Confirm, Mark packed, Mark shipped needing carrier and tracking number, Mark delivered). Only transitions allowed by the state machine appear. Sections: items with the customer's photos (view and download originals), customer and contact, delivery address with a copy button and print view, payment (gateway ids) and refunds, invoice (view and resend), shipment form, status history, admin note. Cancel and Refund ask for a reason and confirm the amount.

**Customers.** List: name, email, phone, order count, total spent, joined, active. Search. Detail panel with profile, addresses, orders. Deactivate. Guest buyers appear by email.

**Sales overview.** Date range, revenue, orders, average order value, refunds, revenue by type, top products, orders by status, payment methods.

**Settings.** Store profile (legal name, GSTIN, address, state, support email and phone), shipping (flat fee, free-above amount), production and delivery time text, admin accounts.

## 6. Open items

Decided 2026-11-22: flat shipping ₹40, free from ₹499; delivery 3 to 5 days; no returns except damaged, defective or wrong items within 48 hours; automatic PDF GST invoices; business address Gridcart, 12/15 Mannappan Lane, Old Washermanpet, Chennai - 600021. Placeholder product price ₹100 for development only.

Still open:

1. Production time for personalised items (owner). Confirm that 3 to 5 days includes making the item.
2. Cancellation rule: until which order status a customer may cancel (proposal: until the owner confirms the order).
3. Legal business name, GSTIN, support email and phone (owner).
4. GST on the shipping fee and credit notes for refunds (confirm with the CA).
5. Customer photo limits: the proposed defaults in section 3 stand unless changed.
6. Real prices. The ₹100 placeholder must never go live.
7. Hero image choice from the real product photos.
