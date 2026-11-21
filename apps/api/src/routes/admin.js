const express = require('express');
const pool = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/audit-logs', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.created_at, u.email AS actor, a.action, a.entity, a.entity_id
       FROM audit_logs a JOIN users u ON u.id = a.actor_id
       ORDER BY a.id DESC LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;