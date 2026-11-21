# Requirements: B2B Order Management Platform

## 1. Business context
- **Simulated company:** A regional food and beverage wholesaler supplying supermarkets and convenience stores
- **Primary stakeholder:** The operations manager, who oversees stock levels and order fulfilment.
- **Problem:** Staff track stock and incoming orders across spreadsheets and manual updates, which can lead to inventory errors and delays when orders arrive.
- **Decision the system supports:** Which products to restock and which customer orders to fulfil first.

## 2. Scope

- **In scope:** Products, carts, orders, invoices, stock status, admin controls.
- **Out of scope:** Real payment processing, shipping integrations, and support for multiple warehouses.

## 3. User roles
| Role | Can do |
|---|---|
| Customer | Browse products, manage cart, place and view own orders, view own invoices |
| Staff | View all orders, update order status, update stock |
| Admin | Everything above, plus manage products and users, view audit logs |

## 4. Functional requirements
- Users can register and log in (JWT).
- Customers can add products to a cart and place an order.
- Placing an order reduces stock and creates an invoice.
- An invoice is generated for each order.
- Staff can change order status.
- Every important action is written to an audit log.
- Orders can be cancelled while they are PENDING or CONFIRMED.

## 5. Acceptance criteria (must be testable)
1. An order cannot be placed if any item exceeds available stock.
2. A customer cannot view another customer's orders (API returns 403).
3. Two simultaneous orders cannot oversell the same stock.
4. Every order status change creates an audit record.
5. A Customer or Staff user cannot create, edit or delete products (API returns 403).
6. Placing an order creates exactly one invoice with a unique invoice number.

## 6. Success metrics
- A customer can place an order in under two minutes.
- 100% of order status changes are recorded in the audit log.
- Stock quantities always match the orders placed (no negative stock after any order).

## 7. Assumptions and limitations
- Stock is reduced when an order is placed, not when it ships.
- Orders cannot be edited after they are placed; they can only be cancelled while PENDING or CONFIRMED.
- Anyone who registers becomes a Customer; Staff and Admin accounts are created by an Admin.
- Prices are in one currency and invoices use the price at the time of purchase.
- Cancelling an order returns its items to stock.
- A Customer can cancel their own order; Staff and Admin can cancel any order.