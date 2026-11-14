const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    await db.raw('SELECT 1');
    res.json({ status: 'ok', db: 'up', uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});

module.exports = router;