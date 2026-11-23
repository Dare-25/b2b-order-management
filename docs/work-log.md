# Work Log

## 2026-11-21
- Created the GitHub repo and project folders (docs, apps). Read the Project 1 handbook and offer letter.
- Wrote the requirements document: stakeholder, scope, three user roles, six acceptance criteria and success metrics.
- Drew the ER diagram (8 tables) in dbdiagram.io and exported it to docs/erd.png. Saved the schema as docs/schema.dbml.
- Wrote design notes: why order_items stores unit_price, and why checkout needs a transaction plus a lock.
- Installed Node.js and Docker Desktop. The Docker install failed because the Windows "Virtual Machine Platform" feature was not enabled, which needs administrator rights. After enabling it with administrator rights and restarting the computer, Docker started and ran the hello-world test. Also fixed npm being blocked in PowerShell by changing the execution policy for my user.
- Started PostgreSQL 16 in Docker Compose and ran the first migration (8 tables with constraints for roles, order status and non-negative stock).
- Chose Express over NestJS because of the one-month timeline (see decision-log.md). Replaced nodemon with Node's built-in --watch after npm audit flagged a dependency.
- Built the Express API: register and login with bcrypt and JWT, role middleware (401 and 403), products endpoints, and an audit log with an admin-only endpoint.
- Tested authentication, roles, products and the audit log, and recorded results in docs/test-evidence.md.

## 2026-11-22
- Built the cart and checkout. Checkout runs as one transaction with row locking: it creates the order, items, invoice and audit entry, reduces stock, and clears the cart, or rolls everything back.
- Added the order status flow (PENDING, CONFIRMED, SHIPPED, DELIVERED, with cancellation allowed early) and cancellation that returns stock.
- Wrote scripts/concurrency-test.ps1 to fire two simultaneous checkouts for the last unit of stock. Result: exactly one order per run in 3 runs, and stock ended at 0. The console output for run 1 disagreed with the database; recorded as an open issue.
- Created a staff account and tested status changes, invalid transitions, order visibility per role, soft delete, search, pagination and input validation.
- Updated docs/test-evidence.md with all results.

## 2026-11-23
- Wrote the README with setup steps, API overview, design decisions and limitations.
- Drafted LinkedIn post 1 (not posted yet).