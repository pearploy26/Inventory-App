const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/categories — หมวดหมู่ทั้งหมด พร้อมจำนวนสินค้าในแต่ละหมวด
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, COUNT(p.id) AS product_count
    FROM categories c LEFT JOIN products p ON p.category_id = c.id
    GROUP BY c.id ORDER BY c.name
  `).all();
  res.json(rows);
});

// POST /api/categories — เพิ่มหมวดหมู่
router.post('/', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อหมวดหมู่' });
  try {
    const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    res.status(201).json({ id: info.lastInsertRowid, name });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'มีหมวดหมู่นี้อยู่แล้ว' });
    }
    throw err;
  }
});

// DELETE /api/categories/:id — ลบหมวดหมู่ (สินค้าในหมวดจะกลายเป็น "ไม่ระบุหมวด")
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'ไม่พบหมวดหมู่' });
  res.status(204).end();
});

module.exports = router;
