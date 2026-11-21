const express = require('express');
const pool = require('../db');
const audit = require('../audit');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const LOW_STOCK_THRESHOLD = 10;

function validId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

// List products: any logged-in user. Customers only see active products.
router.get('/', async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
  const search = req.query.q ? `%${req.query.q}%` : '%';
  const seesAll = ['STAFF', 'ADMIN'].includes(req.user.role);
  try {
    const result = await pool.query(
      `SELECT id, sku, name, price, stock_qty, is_active,
              CASE WHEN stock_qty = 0 THEN 'OUT_OF_STOCK'
                   WHEN stock_qty <= $5 THEN 'LOW_STOCK'
                   ELSE 'IN_STOCK' END AS stock_status
       FROM products
       WHERE (name ILIKE $1 OR sku ILIKE $1) AND ($2::boolean OR is_active)
       ORDER BY id
       LIMIT $3 OFFSET $4`,
      [search, seesAll, limit, (page - 1) * limit, LOW_STOCK_THRESHOLD]
    );
    res.json({ page, limit, products: result.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create product: admin only
router.post('/', requireRole('ADMIN'), async (req, res) => {
  const { sku, name, price, stock_qty = 0 } = req.body;
  if (!sku || !name || typeof price !== 'number' || price < 0 ||
      !Number.isInteger(stock_qty) || stock_qty < 0) {
    return res.status(400).json({ error: 'sku, name, a price >= 0 and an integer stock_qty >= 0 are required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO products (sku, name, price, stock_qty) VALUES ($1, $2, $3, $4) RETURNING *',
      [sku, name, price, stock_qty]
    );
    await audit(pool, req.user.id, 'PRODUCT_CREATED', 'product', result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'SKU already exists' });
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Edit product details: admin only
router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
  const { name, price, is_active } = req.body;
  if (price !== undefined && (typeof price !== 'number' || price < 0)) {
    return res.status(400).json({ error: 'price must be a number >= 0' });
  }
  try {
    const result = await pool.query(
      `UPDATE products
       SET name = COALESCE($1, name), price = COALESCE($2, price), is_active = COALESCE($3, is_active)
       WHERE id = $4 RETURNING *`,
      [name ?? null, price ?? null, is_active ?? null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    await audit(pool, req.user.id, 'PRODUCT_UPDATED', 'product', result.rows[0].id);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update stock: staff or admin
router.patch('/:id/stock', requireRole('STAFF', 'ADMIN'), async (req, res) => {
  const { stock_qty } = req.body;
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
  if (!Number.isInteger(stock_qty) || stock_qty < 0) {
    return res.status(400).json({ error: 'stock_qty must be an integer >= 0' });
  }
  try {
    const result = await pool.query(
      'UPDATE products SET stock_qty = $1 WHERE id = $2 RETURNING *',
      [stock_qty, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    await audit(pool, req.user.id, 'STOCK_UPDATED', 'product', result.rows[0].id);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// "Delete" product: admin only. Soft delete, because past orders refer to it.
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
  try {
    const result = await pool.query(
      'UPDATE products SET is_active = FALSE WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    await audit(pool, req.user.id, 'PRODUCT_DEACTIVATED', 'product', Number(req.params.id));
    res.status(204).send();
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;