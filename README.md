# Gridcart

Online gift store for customers across India. Shoppers can personalise selected products with their own photo, pay online with Razorpay, and track their order. The owner manages products, stock and orders from an admin dashboard.

Status: in development. See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) for what is built, what is next and how to continue. Requirements, database design and UI design are in [docs](docs).

## Structure

| Folder | Contents |
|---|---|
| `frontend` | Next.js, React, TypeScript, Tailwind CSS |
| `backend` | Node.js, Express, TypeScript REST API |
| `docs` | Requirements, database design, UI design |

## Run locally

Requires Node.js 22 or newer and PostgreSQL 17.

```
cd backend
npm install
npm run dev        # http://localhost:4000/api/health

cd frontend
npm install
npm run dev        # http://localhost:3000
```

Copy `backend/.env.example` to `backend/.env` and fill it in. Never commit `.env` files.
