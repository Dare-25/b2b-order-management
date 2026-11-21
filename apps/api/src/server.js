const express = require('express');
const pool = require('./db');
const { authenticate, requireRole } = require('./middleware/auth');

const app = express();
app.use(express.json());
app.use('/auth', require('./routes/auth'));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ status: 'error', database: 'unreachable' });
  }
});
app.get('/me', authenticate, (req, res) => {
  res.json({ id: req.user.id, role: req.user.role });
});

app.get('/admin-only', authenticate, requireRole('ADMIN'), (req, res) => {
  res.json({ message: 'Welcome, admin' });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));