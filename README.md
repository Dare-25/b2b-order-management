# B2B Order Management Platform

A multi-role ordering system for a simulated food and beverage wholesaler, built as Project 1 of the Arrowstack Full Stack Development internship (Nov 2026).

**Status:** REST API complete and tested manually. No frontend yet (see Limitations).

## What it does

- **Customers** register, browse products, fill a cart, place orders, view their own orders and invoices, and cancel orders that are still PENDING or CONFIRMED.
- **Staff** view all orders, move them through the status flow, and update stock.
- **Admins** do everything above, plus manage products and read the audit log.
- Every important action is written to an audit log with the user who did it.

## Tech stack

Node.js (Express), PostgreSQL 16, Docker Compose, JWT authentication (jsonwebtoken), bcrypt password hashing (bcryptjs), `pg` for database access.

## Setup

Requirements: Node.js, Docker Desktop (running), Git. Developed with Node v26 on Windows 11 and PowerShell.

1. **Clone and configure**
   ```powershell
   git clone https://github.com/Dare-25/b2b-order-management.git
   cd b2b-order-management
   copy .env.example .env
   ```
   Open `.env` and set your own `DB_PASSWORD` and a long random `JWT_SECRET`. Never commit `.env`.

2. **Start the database**
   ```powershell
   docker compose up -d
   docker compose ps        # wait until b2b-db shows (healthy)
   ```

3. **Create the tables**
   ```powershell
   Get-Content db\migrations\001_init.sql | docker exec -i b2b-db psql -U b2b_user -d b2b_orders
   ```
   (Use your own `DB_USER` and `DB_NAME` if you changed them in `.env`.)

4. **Install and start the API**
   ```powershell
   cd apps\api
   npm install
   npm run dev
   ```
   The API runs on http://localhost:3000. Check that http://localhost:3000/health returns `{"status":"ok","database":"connected"}`.

5. **Create an admin and a staff user**
   Anyone who registers becomes a CUSTOMER. Register the users through the API, then promote them directly in the database:
   ```powershell
   docker exec -it b2b-db psql -U b2b_user -d b2b_orders -c "UPDATE users SET role='ADMIN' WHERE email='test@shop.com';"
   docker exec -it b2b-db psql -U b2b_user -d b2b_orders -c "UPDATE users SET role='STAFF' WHERE email='staff@shop.com';"
   ```
   Log in again after a role change, because the role is stored inside the token.

## API overview

| Method and path | Who | Purpose |
|---|---|---|
| POST /auth/register | anyone | Create a CUSTOMER account |
| POST /auth/login | anyone | Returns a JWT (valid 8 hours) |
| GET /products | any logged-in user | List with search (`q`), `page`, `limit`; customers see active products only |
| POST /products | admin | Create a product |
| PATCH /products/:id | admin | Edit name, price, active flag |
| PATCH /products/:id/stock | staff, admin | Set stock quantity |
| DELETE /products/:id | admin | Deactivate (soft delete) |
| GET /cart | customer | View cart with totals |
| POST /cart/items | customer | Add a product (quantities accumulate) |
| DELETE /cart/items/:productId | customer | Remove a product |
| POST /orders | customer | Checkout (single transaction) |
| GET /orders, GET /orders/:id | logged-in | Own orders (customer) or all (staff, admin) |
| PATCH /orders/:id/status | staff, admin | Move along PENDING, CONFIRMED, SHIPPED, DELIVERED |
| POST /orders/:id/cancel | owner, staff, admin | Cancel while PENDING or CONFIRMED; returns stock |
| GET /admin/audit-logs | admin | Latest 50 audit entries |

Send the token as `Authorization: Bearer <token>`. `GET /me` and `GET /admin-only` are small routes used to test the auth middleware.

## Design decisions

- **Checkout is one database transaction.** Product rows are locked with `SELECT ... FOR UPDATE`, stock is checked, and the order, items, stock reduction, invoice, audit entry and cart clearing commit together or not at all. A `CHECK (stock_qty >= 0)` constraint is a second safety net.
- **`order_items.unit_price`** stores the price at purchase time, so changing a product's price later does not change old orders or invoices.
- **Products are soft-deleted** because past orders refer to them.
- **Roles are enforced on the server** (401 for no or bad token, 403 for the wrong role), and the user id always comes from the token, never from the request body.
- **Express instead of NestJS** was chosen for the one-month timeline; see `docs/decision-log.md`.

## Running the tests

The automated tests use Jest and Supertest and run against a separate database, `b2b_test`, so they never touch the development data. Create it once:

```powershell
docker exec -it b2b-db psql -U b2b_user -d b2b_orders -c "CREATE DATABASE b2b_test;"
Get-Content db\migrations\001_init.sql | docker exec -i b2b-db psql -U b2b_user -d b2b_test
```

Then, from `apps\api`:

```powershell
npm test
```

The 39 tests cover authentication and roles, products, the cart, checkout, order visibility, the status flow and cancellation, the audit log, and concurrency (two customers racing for the last unit in five rounds, and eight buyers racing for three units). The suite refuses to run if it is not connected to `b2b_test`.

## Documentation and evidence

- `docs/requirements.md`: stakeholder, scope, roles and acceptance criteria
- `docs/erd.png` and `docs/schema.dbml`: data model
- `docs/design-notes.md`: design reasoning
- `docs/decision-log.md`: technical decisions
- `docs/test-evidence.md`: what was tested and the results
- `docs/work-log.md`: dated work log
- `scripts/concurrency-test.ps1`: fires two simultaneous checkouts for the last unit of stock

## Limitations and next steps

- **No frontend.** Everything was tested through the API with PowerShell.
- **The automated tests cover the API only.** There are no frontend tests, because there is no frontend. `npm audit` reports moderate issues in the test tools' dependencies, which were not addressed.
- **Migrations are one plain SQL file** applied by hand, with no migration history table.
- **The automated tests cover the API only.** There are no frontend tests, because there is no frontend. `npm audit` reports moderate issues in the test tools' dependencies, which were not addressed.
- **Product and stock audit entries are written outside a transaction,** so a crash between the change and its log entry could leave a change unlogged. Order actions are logged inside their transaction.
- **Tokens last 8 hours** with no refresh or revocation, and there is no rate limiting.
- **Staff and admin accounts are created in the database,** not through an admin screen.
- **Payments, shipping and multiple warehouses are out of scope,** as in the requirements.