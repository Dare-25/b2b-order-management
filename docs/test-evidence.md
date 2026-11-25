# Test Evidence

Tests were run on 2026-11-21 and 2026-11-22 against the local API (Express on http://localhost:3000, PostgreSQL 16 in Docker), using PowerShell `Invoke-RestMethod`. Test accounts: one admin, one staff user and two customers.

## 1. Authentication and roles
| Check | Expected | Result |
|---|---|---|
| Register a new user | 201, role CUSTOMER | Pass |
| Log in with correct credentials | JWT returned | Pass |
| GET /me with no token | 401 "Missing token" | Pass |
| GET /admin-only with a CUSTOMER token | 403 Forbidden | Pass |
| GET /admin-only with an ADMIN token | 200 "Welcome, admin" | Pass |
| Register with an email that already exists | 409 "Email already registered" | Pass |
| Register with a password shorter than 8 characters | 400 validation error | Pass |
| Log in with a wrong password | 401 "Invalid email or password" | Pass |


## 2. Products and role checks
| Check | Expected | Result |
|---|---|---|
| Admin creates a product (RICE-5KG, OIL-1L) | Product created | Pass |
| Customer creates a product | 403 Forbidden (criterion 5) | Pass |
| Customer lists products | 200, active products shown with stock status | Pass |
| Admin creates a duplicate SKU | 409 "SKU already exists" | Pass |
| Admin creates a product with a negative price | 400 validation error | Pass |
| Admin updates a price (12.50 to 13.00) | Updated product returned | Pass |
| Admin sets a product's stock quantity (OIL-1L to 100) | Updated product returned | Pass |
| Customer tries to set a product's stock | 403 Forbidden | Pass |
| Admin sends a non-numeric product id (the literal text `<id>`) | 400 "Invalid product id" | Pass |
| Admin deletes a product (TEMP-1) | Product deactivated, not removed | Pass |
| Customer lists products after the delete | Deactivated product is not shown | Pass |
| Admin lists products after the delete | Deactivated product is still shown with is_active False | Pass |
| Staff sets a product's stock (OIL-1L to 120) | Updated product returned, STOCK_UPDATED logged with the staff user as actor | Pass |
| Customer searches products with `?q=rice` | Only RICE-5KG returned | Pass |
| Customer lists products with `limit=1` (pages 1 and 2) | One product per page, different on each page (ids 1 and 3) | Pass |

## 3. Audit log
| Check | Expected | Result |
|---|---|---|
| Admin creates and updates products | PRODUCT_CREATED and PRODUCT_UPDATED recorded with the admin as actor | Pass |
| Admin changes stock | STOCK_UPDATED recorded | Pass |
| Customer places an order | ORDER_PLACED recorded with the customer as actor | Pass |
| Customer cancels an order | ORDER_STATUS_CANCELLED recorded (criterion 4) | Pass |
| Staff confirms and ships an order | ORDER_STATUS_CONFIRMED and ORDER_STATUS_SHIPPED recorded with the staff user as actor (criterion 4) | Pass |
| Customer reads GET /admin/audit-logs | 403 Forbidden | Pass |

The actor in each entry comes from the login token, not from anything the user sends in the request.

## 4. Cart
| Check | Expected | Result |
|---|---|---|
| Customer adds 3 x RICE-5KG and views the cart | 3 items, line total 39.00 | Pass |
| Staff user opens the cart | 403 Forbidden | Pass |
| Customer adds a product with quantity 0 | 400 validation error | Pass |
| Customer adds a product that does not exist (id 999) | 404 "Product not found" | Pass |

## 5. Orders and stock
| Check | Expected | Result |
|---|---|---|
| Checkout with 3 x RICE-5KG in the cart | 201, order 1, invoice INV-2026-000001, total 39.00, status PENDING | Pass |
| Stock after checkout | RICE-5KG drops from 40 to 37 | Pass |
| View order 1 | Items show unit_price 13.00, invoice attached | Pass |
| Checkout with 500 units when 37 are in stock | 409 "Insufficient stock" with details (criterion 1) | Pass |
| A second customer requests order 1 | 403 Forbidden (criterion 2) | Pass |
| Customer cancels order 1 | Status CANCELLED | Pass |
| Stock after cancellation | RICE-5KG returns to 40 | Pass |
| Cancel the same order again | 409 "Cannot change status from CANCELLED to CANCELLED" | Pass |
| After the rejected 500-unit checkout, check stock and order count | Stock unchanged (RICE-5KG 40, OIL-1L 0) and order count unchanged (4) | Pass |
| Customer 1 lists orders | Only their own orders (4 orders, all user 2) | Pass |
| Customer 2, who has no orders, lists orders | Empty list (0 orders) | Pass |
| Staff lists orders | All orders (4) | Pass |

## 6. Order status flow (staff)
| Check | Expected | Result |
|---|---|---|
| Customer tries to change an order's status to CONFIRMED | 403 Forbidden | Pass |
| Staff changes PENDING to SHIPPED (skipping a step) | 409 "Cannot change status from PENDING to SHIPPED" | Pass |
| Staff changes PENDING to CONFIRMED, then to SHIPPED | Each step succeeds | Pass |
| Customer cancels a SHIPPED order | 409 "Cannot change status from SHIPPED to CANCELLED" | Pass |
| Staff changes SHIPPED to DELIVERED | Status DELIVERED | Pass |
| Staff tries to change a DELIVERED order to CANCELLED | 409 "Cannot change status from DELIVERED to CANCELLED" | Pass |
| Staff repeats DELIVERED on a DELIVERED order | 409 "Cannot change status from DELIVERED to DELIVERED" | Pass |
| Staff sends an invalid status value (FLYING) | 400 "Invalid status" | Pass |
| Staff sends a non-numeric order id (abc) | 400 "Invalid order id" | Pass |
| Staff sends an unknown order id (9999) | 404 "Order not found" | Pass |

## 7. Concurrency (criterion 3)
| Check | Expected | Result |
|---|---|---|
| Two near-simultaneous checkouts for the last unit (`scripts/concurrency-test.ps1`, 3 runs) | Exactly one order, stock ends at 0 | The database shows exactly one order per run (orders 2, 3 and 4) and stock ended at 0 each time: pass. The console output for run 1 showed two rejections although the audit log records order 2; the cause was not identified. Customer 1 won every run, so the requests may not overlap fully. |

## 8. Automated tests
Jest and Supertest tests were added in `apps/api/tests/orders.test.js` and run against a separate test database (`b2b_test`).

| Check | Expected | Result |
|---|---|---|
| `npm test` (authentication, products, cart, checkout, visibility, status flow, cancellation, concurrency, audit log) | All tests pass | 39 passed on 2026-11-25, and again on a second run |
| Two customers racing for the last unit, 5 rounds | Exactly one succeeds each round, stock ends at 0 | Pass |
| Eight buyers racing for three units | Exactly 3 succeed and 5 are refused, stock ends at 0, units sold = 3 | Pass |