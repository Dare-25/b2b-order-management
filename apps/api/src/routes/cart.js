const express = require('express');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('CUSTOMER'));

// Each customer has one cart, created the first time it is needed.
async function getCartId(userId) {
  const r = await pool.query(
    `INSERT INTO carts (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING id`,
    [userId]
  );
  return r.rows[0].id;
}

router.get('/', async (req, res) => {
  try {
    const cartId = await getCartId(req.user.id);
    const items = await pool.query(
      `SELECT ci.product_id, p.sku, p.name, p.price, ci.quantity,
              (p.price * ci.quantity) AS line_total
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = $1 ORDER BY ci.id`,
      [cartId]
    );
    const total = await pool.query(
      `SELECT COALESCE(SUM(p.price * ci.quantity), 0) AS total
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = $1`,
      [cartId]
    );
    res.json({ items: items.rows, total: total.rows[0].total });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a product (or increase its quantity if it is already in the cart)
router.post('/items', async (req, res) => {
  const { product_id, quantity } = req.body;
  if (!Number.isInteger(product_id) || product_id < 1 ||
      !Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'product_id and a quantity of at least 1 are required (integers)' });
  }
  try {
    const product = await pool.query(
      'SELECT id FROM products WHERE id = $1 AND is_active', [product_id]
    );
    if (product.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const cartId = await getCartId(req.user.id);
    await pool.query(
      `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity`,
      [cartId, product_id, quantity]
    );
    res.status(201).json({ message: 'Added to cart' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/items/:productId', async (req, res) => {
  const productId = Number(req.params.productId);
  if (!Number.isInteger(productId) || productId < 1) {
    return res.status(400).json({ error: 'Invalid product id' });
  }
  try {
    const cartId = await getCartId(req.user.id);
    const result = await pool.query(
      'DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2 RETURNING id',
      [cartId, productId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Item not in cart' });
    res.status(204).send();
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;