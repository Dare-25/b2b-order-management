const express = require('express');
const pool = require('../db');
const audit = require('../audit');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

function validId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

function handleError(err, res) {
  if (err.http) return res.status(err.http).json(err.body);
  console.error(err.message);
  res.status(500).json({ error: 'Server error' });
}

// Checkout: everything below succeeds or fails together.
router.post('/', requireRole('CUSTOMER'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cart = await client.query('SELECT id FROM carts WHERE user_id = $1', [req.user.id]);
    if (cart.rows.length === 0) throw { http: 400, body: { error: 'Cart is empty' } };

    // Lock the product rows being bought (in id order, so two orders can't deadlock).
    const lines = await client.query(
      `SELECT ci.product_id, ci.quantity, p.name, p.price, p.stock_qty, p.is_active
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = $1
       ORDER BY ci.product_id
       FOR UPDATE OF p`,
      [cart.rows[0].id]
    );
    if (lines.rows.length === 0) throw { http: 400, body: { error: 'Cart is empty' } };

    const problems = [];
    for (const l of lines.rows) {
      if (!l.is_active) problems.push(`${l.name} is no longer available`);
      else if (l.quantity > l.stock_qty) {
        problems.push(`${l.name}: requested ${l.quantity}, only ${l.stock_qty} in stock`);
      }
    }
    if (problems.length > 0) throw { http: 409, body: { error: 'Insufficient stock', details: problems } };

    const totalCents = lines.rows.reduce(
      (sum, l) => sum + Math.round(parseFloat(l.price) * 100) * l.quantity, 0
    );
    const total = (totalCents / 100).toFixed(2);

    const order = await client.query(
      `INSERT INTO orders (user_id, status, total) VALUES ($1, 'PENDING', $2) RETURNING id`,
      [req.user.id, total]
    );
    const orderId = order.rows[0].id;

    for (const l of lines.rows) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
        [orderId, l.product_id, l.quantity, l.price]
      );
      await client.query(
        'UPDATE products SET stock_qty = stock_qty - $1 WHERE id = $2',
        [l.quantity, l.product_id]
      );
    }

    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(orderId).padStart(6, '0')}`;
    await client.query(
      'INSERT INTO invoices (order_id, invoice_number, total) VALUES ($1, $2, $3)',
      [orderId, invoiceNumber, total]
    );

    await audit(client, req.user.id, 'ORDER_PLACED', 'order', orderId);
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cart.rows[0].id]);

    await client.query('COMMIT');
    res.status(201).json({ order_id: orderId, invoice_number: invoiceNumber, total, status: 'PENDING' });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23514') {
      return res.status(409).json({ error: 'Insufficient stock' });
    }
    handleError(err, res);
  } finally {
    client.release();
  }
});

// List orders: customers see their own, staff and admin see all.
router.get('/', async (req, res) => {
  const all = ['STAFF', 'ADMIN'].includes(req.user.role);
  try {
    const result = await pool.query(
      `SELECT id, user_id, status, total, created_at FROM orders
       WHERE ($1::boolean OR user_id = $2) ORDER BY id DESC LIMIT 50`,
      [all, req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    handleError(err, res);
  }
});

// One order with its items and invoice.
router.get('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid order id' });
  try {
    const o = await pool.query(
      `SELECT o.id, o.user_id, o.status, o.total, o.created_at, i.invoice_number, i.issued_at
       FROM orders o LEFT JOIN invoices i ON i.order_id = o.id WHERE o.id = $1`,
      [req.params.id]
    );
    if (o.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    const order = o.rows[0];
    if (req.user.role === 'CUSTOMER' && order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const items = await pool.query(
      `SELECT oi.product_id, p.name, oi.quantity, oi.unit_price
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1 ORDER BY oi.id`,
      [order.id]
    );
    res.json({ ...order, items: items.rows });
  } catch (err) {
    handleError(err, res);
  }
});

async function changeStatus(orderId, newStatus, user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const o = await client.query(
      'SELECT id, user_id, status FROM orders WHERE id = $1 FOR UPDATE', [orderId]
    );
    if (o.rows.length === 0) throw { http: 404, body: { error: 'Order not found' } };
    const order = o.rows[0];

    if (user.role === 'CUSTOMER' && (order.user_id !== user.id || newStatus !== 'CANCELLED')) {
      throw { http: 403, body: { error: 'Forbidden' } };
    }
    if (!TRANSITIONS[order.status] || !TRANSITIONS[order.status].includes(newStatus)) {
      throw { http: 409, body: { error: `Cannot change status from ${order.status} to ${newStatus}` } };
    }
    if (newStatus === 'CANCELLED') {
      await client.query(
        `UPDATE products p SET stock_qty = p.stock_qty + oi.quantity
         FROM order_items oi WHERE oi.order_id = $1 AND oi.product_id = p.id`,
        [orderId]
      );
    }
    await client.query('UPDATE orders SET status = $1 WHERE id = $2', [newStatus, orderId]);
    await audit(client, user.id, `ORDER_STATUS_${newStatus}`, 'order', orderId);
    await client.query('COMMIT');
    return { id: orderId, status: newStatus };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Staff or admin move an order along its status flow.
router.patch('/:id/status', requireRole('STAFF', 'ADMIN'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid order id' });
  const { status } = req.body;
  if (!TRANSITIONS[status]) return res.status(400).json({ error: 'Invalid status' });
  try {
    res.json(await changeStatus(Number(req.params.id), status, req.user));
  } catch (err) {
    handleError(err, res);
  }
});

// A customer cancels their own order (staff and admin can cancel any).
router.post('/:id/cancel', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid order id' });
  try {
    res.json(await changeStatus(Number(req.params.id), 'CANCELLED', req.user));
  } catch (err) {
    handleError(err, res);
  }
});

module.exports = router;