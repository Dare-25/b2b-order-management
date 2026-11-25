const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/db');

jest.setTimeout(30000);

const PASSWORD = 'Password123';
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const money = (value) => Number(value);

let customer1, customer2, staff, admin;

async function register(email) {
  const res = await request(app).post('/auth/register')
    .send({ email, password: PASSWORD, company_name: 'Test Co' });
  expect(res.status).toBe(201);
}

async function login(email) {
  const res = await request(app).post('/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token;
}

async function createProduct(sku, price = 10, stock_qty = 100) {
  const res = await request(app).post('/products').set(auth(admin))
    .send({ sku, name: `Product ${sku}`, price, stock_qty });
  expect(res.status).toBe(201);
  return res.body;
}

const addToCart = (token, product_id, quantity) =>
  request(app).post('/cart/items').set(auth(token)).send({ product_id, quantity });
const checkout = (token) => request(app).post('/orders').set(auth(token));
const setStatus = (token, id, status) =>
  request(app).patch(`/orders/${id}/status`).set(auth(token)).send({ status });
const cancel = (token, id) => request(app).post(`/orders/${id}/cancel`).set(auth(token));
const stockOf = async (id) =>
  (await pool.query('SELECT stock_qty FROM products WHERE id = $1', [id])).rows[0].stock_qty;
const countOrders = async () =>
  Number((await pool.query('SELECT COUNT(*) FROM orders')).rows[0].count);

async function placeOrder(token, productId, quantity) {
  expect((await addToCart(token, productId, quantity)).status).toBe(201);
  const res = await checkout(token);
  expect(res.status).toBe(201);
  return res.body.order_id;
}

beforeAll(async () => {
  // Safety: never wipe the real database.
  const db = await pool.query('SELECT current_database() AS name');
  if (db.rows[0].name !== 'b2b_test') {
    throw new Error(`Tests must run against b2b_test, not ${db.rows[0].name}`);
  }
  await pool.query(
    'TRUNCATE audit_logs, invoices, order_items, orders, cart_items, carts, products, users RESTART IDENTITY CASCADE'
  );
  await register('customer1@test.com');
  await register('customer2@test.com');
  await register('staff@test.com');
  await register('admin@test.com');
  await pool.query("UPDATE users SET role='STAFF' WHERE email='staff@test.com'");
  await pool.query("UPDATE users SET role='ADMIN' WHERE email='admin@test.com'");
  customer1 = await login('customer1@test.com');
  customer2 = await login('customer2@test.com');
  staff = await login('staff@test.com');
  admin = await login('admin@test.com');
});

beforeEach(async () => {
  await pool.query('DELETE FROM cart_items');
});

afterAll(async () => {
  await pool.end();
});

describe('authentication and roles', () => {
  test('registering creates a CUSTOMER', async () => {
    const res = await request(app).post('/auth/register')
      .send({ email: 'new@test.com', password: PASSWORD, company_name: 'New Co' });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('CUSTOMER');
  });

  test('a duplicate email is refused with 409', async () => {
    const res = await request(app).post('/auth/register')
      .send({ email: 'customer1@test.com', password: PASSWORD });
    expect(res.status).toBe(409);
  });

  test('a short password is refused with 400', async () => {
    const res = await request(app).post('/auth/register')
      .send({ email: 'short@test.com', password: 'short' });
    expect(res.status).toBe(400);
  });

  test('a wrong password is refused with 401', async () => {
    const res = await request(app).post('/auth/login')
      .send({ email: 'customer1@test.com', password: 'WrongPassword' });
    expect(res.status).toBe(401);
  });

  test('a request without a token is refused with 401', async () => {
    expect((await request(app).get('/me')).status).toBe(401);
  });

  test('a customer is refused (403) on an admin route and an admin is let in', async () => {
    expect((await request(app).get('/admin-only').set(auth(customer1))).status).toBe(403);
    expect((await request(app).get('/admin-only').set(auth(admin))).status).toBe(200);
  });
});

describe('products and role checks', () => {
  test('an admin can create a product', async () => {
    const p = await createProduct('RICE-5KG', 12.5, 40);
    expect(p.sku).toBe('RICE-5KG');
    expect(money(p.price)).toBe(12.5);
    expect(p.stock_qty).toBe(40);
  });

  test('a customer and a staff user cannot create a product', async () => {
    const body = { sku: 'NOPE-1', name: 'Nope', price: 1, stock_qty: 1 };
    expect((await request(app).post('/products').set(auth(customer1)).send(body)).status).toBe(403);
    expect((await request(app).post('/products').set(auth(staff)).send(body)).status).toBe(403);
  });

  test('a duplicate SKU is refused with 409', async () => {
    await createProduct('DUP-1');
    const res = await request(app).post('/products').set(auth(admin))
      .send({ sku: 'DUP-1', name: 'Again', price: 1, stock_qty: 1 });
    expect(res.status).toBe(409);
  });

  test('a negative price is refused with 400', async () => {
    const res = await request(app).post('/products').set(auth(admin))
      .send({ sku: 'BAD-1', name: 'Bad', price: -5, stock_qty: 1 });
    expect(res.status).toBe(400);
  });

  test('customers see the stock status of each product', async () => {
    await createProduct('STAT-OUT', 1, 0);
    await createProduct('STAT-LOW', 1, 5);
    await createProduct('STAT-OK', 1, 50);
    const res = await request(app).get('/products?q=STAT-').set(auth(customer1));
    expect(res.status).toBe(200);
    const status = (sku) => res.body.products.find((p) => p.sku === sku).stock_status;
    expect(status('STAT-OUT')).toBe('OUT_OF_STOCK');
    expect(status('STAT-LOW')).toBe('LOW_STOCK');
    expect(status('STAT-OK')).toBe('IN_STOCK');
  });

  test('search and pagination work', async () => {
    await createProduct('PAGE-A');
    await createProduct('PAGE-B');
    const page1 = await request(app).get('/products?q=PAGE-&limit=1&page=1').set(auth(customer1));
    const page2 = await request(app).get('/products?q=PAGE-&limit=1&page=2').set(auth(customer1));
    expect(page1.body.products).toHaveLength(1);
    expect(page2.body.products).toHaveLength(1);
    expect(page1.body.products[0].id).not.toBe(page2.body.products[0].id);
  });

  test('a deleted product is only deactivated: customers no longer see it, admins still do', async () => {
    const p = await createProduct('DEL-1');
    const del = await request(app).delete(`/products/${p.id}`).set(auth(admin));
    expect(del.status).toBe(204);
    const asCustomer = await request(app).get('/products?q=DEL-1').set(auth(customer1));
    expect(asCustomer.body.products).toHaveLength(0);
    const asAdmin = await request(app).get('/products?q=DEL-1').set(auth(admin));
    expect(asAdmin.body.products[0].is_active).toBe(false);
  });

  test('staff can set stock, customers cannot, and negative stock is refused', async () => {
    const p = await createProduct('STOCK-1', 1, 10);
    const ok = await request(app).patch(`/products/${p.id}/stock`).set(auth(staff)).send({ stock_qty: 25 });
    expect(ok.status).toBe(200);
    expect(ok.body.stock_qty).toBe(25);
    const denied = await request(app).patch(`/products/${p.id}/stock`).set(auth(customer1)).send({ stock_qty: 99 });
    expect(denied.status).toBe(403);
    const negative = await request(app).patch(`/products/${p.id}/stock`).set(auth(staff)).send({ stock_qty: -1 });
    expect(negative.status).toBe(400);
  });
});

describe('cart', () => {
  test('staff cannot use the cart', async () => {
    expect((await request(app).get('/cart').set(auth(staff))).status).toBe(403);
  });

  test('a quantity of 0 is refused with 400', async () => {
    const p = await createProduct('CART-0');
    expect((await addToCart(customer1, p.id, 0)).status).toBe(400);
  });

  test('an unknown product is refused with 404', async () => {
    expect((await addToCart(customer1, 999999, 1)).status).toBe(404);
  });

  test('adding the same product twice adds up and the total is correct', async () => {
    const p = await createProduct('CART-1', 10, 100);
    await addToCart(customer1, p.id, 2);
    await addToCart(customer1, p.id, 1);
    const res = await request(app).get('/cart').set(auth(customer1));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].quantity).toBe(3);
    expect(money(res.body.total)).toBe(30);
  });
});

describe('checkout', () => {
  test('checkout creates the order and invoice, reduces stock and empties the cart', async () => {
    const p = await createProduct('CHECK-1', 13, 40);
    await addToCart(customer1, p.id, 3);
    const res = await checkout(customer1);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(money(res.body.total)).toBe(39);
    expect(res.body.invoice_number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(await stockOf(p.id)).toBe(37);
    const cart = await request(app).get('/cart').set(auth(customer1));
    expect(cart.body.items).toHaveLength(0);
    const invoices = await pool.query('SELECT COUNT(*) FROM invoices WHERE order_id = $1', [res.body.order_id]);
    expect(Number(invoices.rows[0].count)).toBe(1);
  });

  test('the price is frozen at purchase time', async () => {
    const p = await createProduct('FREEZE-1', 13, 40);
    const orderId = await placeOrder(customer1, p.id, 3);
    await request(app).patch(`/products/${p.id}`).set(auth(admin)).send({ price: 20 });
    const view = await request(app).get(`/orders/${orderId}`).set(auth(customer1));
    expect(money(view.body.items[0].unit_price)).toBe(13);
    expect(money(view.body.total)).toBe(39);
  });

  test('an empty cart is refused with 400', async () => {
    expect((await checkout(customer1)).status).toBe(400);
  });

  test('only customers can check out', async () => {
    expect((await checkout(staff)).status).toBe(403);
  });

  test('too many units are refused with 409 and nothing changes', async () => {
    const p = await createProduct('SHORT-1', 5, 5);
    await addToCart(customer1, p.id, 500);
    const ordersBefore = await countOrders();
    const res = await checkout(customer1);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Insufficient stock');
    expect(res.body.details[0]).toMatch(/only 5 in stock/);
    expect(await stockOf(p.id)).toBe(5);
    expect(await countOrders()).toBe(ordersBefore);
  });

  test('a product that was deactivated after being added to the cart is refused', async () => {
    const p = await createProduct('GONE-1', 5, 10);
    await addToCart(customer1, p.id, 1);
    await request(app).delete(`/products/${p.id}`).set(auth(admin));
    const res = await checkout(customer1);
    expect(res.status).toBe(409);
    expect(await stockOf(p.id)).toBe(10);
  });
});

describe('who can see which orders', () => {
  test('an order is visible to its owner and to staff, but not to another customer', async () => {
    const p = await createProduct('VIS-1', 5, 50);
    const orderId = await placeOrder(customer1, p.id, 1);
    expect((await request(app).get(`/orders/${orderId}`).set(auth(customer1))).status).toBe(200);
    expect((await request(app).get(`/orders/${orderId}`).set(auth(staff))).status).toBe(200);
    expect((await request(app).get(`/orders/${orderId}`).set(auth(customer2))).status).toBe(403);
  });

  test('order lists are filtered by role', async () => {
    const p = await createProduct('VIS-2', 5, 50);
    const orderId = await placeOrder(customer1, p.id, 1);
    const ids = async (token) => (await request(app).get('/orders').set(auth(token))).body.map((o) => o.id);
    expect(await ids(customer1)).toContain(orderId);
    expect(await ids(customer2)).not.toContain(orderId);
    expect(await ids(staff)).toContain(orderId);
  });

  test('unknown and non-numeric order ids give 404 and 400', async () => {
    expect((await request(app).get('/orders/999999').set(auth(staff))).status).toBe(404);
    expect((await request(app).get('/orders/abc').set(auth(staff))).status).toBe(400);
  });
});

describe('order status flow and cancellation', () => {
  test('a customer cannot change an order status', async () => {
    const p = await createProduct('FLOW-1', 5, 50);
    const orderId = await placeOrder(customer1, p.id, 1);
    expect((await setStatus(customer1, orderId, 'CONFIRMED')).status).toBe(403);
  });

  test('staff cannot skip a step, send a bad status, or use a bad id', async () => {
    const p = await createProduct('FLOW-2', 5, 50);
    const orderId = await placeOrder(customer1, p.id, 1);
    expect((await setStatus(staff, orderId, 'SHIPPED')).status).toBe(409);
    expect((await setStatus(staff, orderId, 'FLYING')).status).toBe(400);
    expect((await setStatus(staff, 'abc', 'CONFIRMED')).status).toBe(400);
    expect((await setStatus(staff, 999999, 'CONFIRMED')).status).toBe(404);
  });

  test('the full flow works and a delivered order cannot move again', async () => {
    const p = await createProduct('FLOW-3', 5, 50);
    const orderId = await placeOrder(customer1, p.id, 1);
    expect((await setStatus(staff, orderId, 'CONFIRMED')).body.status).toBe('CONFIRMED');
    expect((await setStatus(staff, orderId, 'SHIPPED')).body.status).toBe('SHIPPED');
    expect((await setStatus(staff, orderId, 'DELIVERED')).body.status).toBe('DELIVERED');
    expect((await setStatus(staff, orderId, 'CANCELLED')).status).toBe(409);
  });

  test('cancelling returns the stock, and an order cannot be cancelled twice', async () => {
    const p = await createProduct('FLOW-4', 5, 10);
    const orderId = await placeOrder(customer1, p.id, 4);
    expect(await stockOf(p.id)).toBe(6);
    const first = await cancel(customer1, orderId);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('CANCELLED');
    expect(await stockOf(p.id)).toBe(10);
    expect((await cancel(customer1, orderId)).status).toBe(409);
    expect(await stockOf(p.id)).toBe(10);
  });

  test('another customer cannot cancel an order', async () => {
    const p = await createProduct('FLOW-5', 5, 50);
    const orderId = await placeOrder(customer1, p.id, 1);
    expect((await cancel(customer2, orderId)).status).toBe(403);
  });

  test('a shipped order cannot be cancelled by the customer', async () => {
    const p = await createProduct('FLOW-6', 5, 50);
    const orderId = await placeOrder(customer1, p.id, 1);
    await setStatus(staff, orderId, 'CONFIRMED');
    await setStatus(staff, orderId, 'SHIPPED');
    expect((await cancel(customer1, orderId)).status).toBe(409);
  });

  test('staff can cancel any open order and the stock comes back', async () => {
    const p = await createProduct('FLOW-7', 5, 10);
    const orderId = await placeOrder(customer1, p.id, 2);
    expect((await cancel(staff, orderId)).status).toBe(200);
    expect(await stockOf(p.id)).toBe(10);
  });
});

describe('concurrency: stock can never be oversold', () => {
  test('two customers racing for the last unit: exactly one wins, in each of 5 rounds', async () => {
    for (let round = 1; round <= 5; round++) {
      await pool.query('DELETE FROM cart_items');
      const p = await createProduct(`LAST-${round}`, 5, 1);
      await addToCart(customer1, p.id, 1);
      await addToCart(customer2, p.id, 1);
      const results = await Promise.all([checkout(customer1), checkout(customer2)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await stockOf(p.id)).toBe(0);
    }
  });

  test('eight buyers racing for three units: exactly three succeed and stock ends at 0', async () => {
    const p = await createProduct('SCARCE-1', 5, 3);
    const buyers = [];
    for (let i = 1; i <= 8; i++) {
      await register(`buyer${i}@test.com`);
      buyers.push(await login(`buyer${i}@test.com`));
    }
    for (const token of buyers) {
      expect((await addToCart(token, p.id, 1)).status).toBe(201);
    }
    const results = await Promise.all(buyers.map((t) => checkout(t)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await stockOf(p.id)).toBe(0);
    const sold = await pool.query(
      'SELECT COALESCE(SUM(quantity), 0) AS sold FROM order_items WHERE product_id = $1', [p.id]
    );
    expect(Number(sold.rows[0].sold)).toBe(3);
  });
});

describe('audit log', () => {
  test('every kind of important action was recorded by the tests above', async () => {
    const res = await pool.query('SELECT DISTINCT action FROM audit_logs');
    const actions = res.rows.map((r) => r.action);
    for (const expected of [
      'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'STOCK_UPDATED', 'PRODUCT_DEACTIVATED',
      'ORDER_PLACED', 'ORDER_STATUS_CONFIRMED', 'ORDER_STATUS_SHIPPED',
      'ORDER_STATUS_DELIVERED', 'ORDER_STATUS_CANCELLED',
    ]) {
      expect(actions).toContain(expected);
    }
  });

  test('the actor of an order is the customer who placed it', async () => {
    const res = await pool.query(
      "SELECT u.email FROM audit_logs a JOIN users u ON u.id = a.actor_id WHERE a.action = 'ORDER_PLACED' LIMIT 1"
    );
    expect(res.rows[0].email).toMatch(/@test\.com$/);
  });

  test('only an admin can read the audit log', async () => {
    const asAdmin = await request(app).get('/admin/audit-logs').set(auth(admin));
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.length).toBeGreaterThan(0);
    expect(asAdmin.body[0]).toHaveProperty('actor');
    expect((await request(app).get('/admin/audit-logs').set(auth(staff))).status).toBe(403);
    expect((await request(app).get('/admin/audit-logs').set(auth(customer1))).status).toBe(403);
  });
});