const path = require('path');
const express = require('express');
const db = require('./db');
const productsRouter = require('./routes/products');
const categoriesRouter = require('./routes/categories');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// log ทุก request ไว้ดูตอนดีบัก
app.use((req, res, next) => {
  console.log(`${new Date().toLocaleTimeString('th-TH')}  ${req.method} ${req.originalUrl}`);
  next();
});

// เสิร์ฟไฟล์ฝั่งไคลเอนต์จากโฟลเดอร์ /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// API
app.use('/api/products', productsRouter);
app.use('/api/categories', categoriesRouter);

// GET /api/summary — ภาพรวมคลังสินค้า
app.get('/api/summary', (req, res) => {
  const summary = db.prepare(`
    SELECT COUNT(*)                                   AS total_products,
           COALESCE(SUM(quantity), 0)                 AS total_units,
           COALESCE(SUM(quantity * price), 0)         AS total_value,
           COALESCE(SUM(quantity <= min_stock), 0)    AS low_stock_count
    FROM products
  `).get();
  res.json(summary);
});

// endpoint ที่ไม่มีอยู่
app.use('/api', (req, res) => res.status(404).json({ error: 'ไม่พบ endpoint นี้' }));

// จัดการ error ที่ไม่ได้ดักไว้
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
});

app.listen(PORT, () => {
  console.log(`Inventory app running at http://localhost:${PORT}`);
});
