const express = require('express');
const db = require('../db');

const router = express.Router();

const SELECT_PRODUCT = `
  SELECT p.*, c.name AS category_name,
         (p.quantity <= p.min_stock) AS is_low_stock
  FROM products p LEFT JOIN categories c ON c.id = p.category_id
`;

// ตรวจข้อมูลสินค้าที่ส่งมา คืนค่าข้อความ error หรือ null ถ้าถูกต้อง
function validate(body, { partial = false } = {}) {
  const required = ['sku', 'name'];
  if (!partial) {
    for (const f of required) {
      if (!body[f] || String(body[f]).trim() === '') return `กรุณาระบุ ${f}`;
    }
  }
  for (const f of ['quantity', 'min_stock']) {
    if (body[f] !== undefined && (!Number.isInteger(Number(body[f])) || Number(body[f]) < 0)) {
      return `${f} ต้องเป็นจำนวนเต็มที่ไม่ติดลบ`;
    }
  }
  if (body.price !== undefined && (isNaN(Number(body.price)) || Number(body.price) < 0)) {
    return 'price ต้องเป็นตัวเลขที่ไม่ติดลบ';
  }
  return null;
}

// GET /api/products?search=&category=&lowStock=true — รายการสินค้า (ค้นหา/กรองได้)
router.get('/', (req, res) => {
  const where = [];
  const params = {};
  if (req.query.search) {
    where.push('(p.name LIKE @q OR p.sku LIKE @q)');
    params.q = `%${req.query.search}%`;
  }
  if (req.query.category) {
    where.push('p.category_id = @cat');
    params.cat = Number(req.query.category);
  }
  if (req.query.lowStock === 'true') where.push('p.quantity <= p.min_stock');

  const sql = SELECT_PRODUCT + (where.length ? ` WHERE ${where.join(' AND ')}` : '') + ' ORDER BY p.sku';
  res.json(db.prepare(sql).all(params));
});

// GET /api/products/:id — สินค้ารายการเดียว
router.get('/:id', (req, res) => {
  const row = db.prepare(SELECT_PRODUCT + ' WHERE p.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบสินค้า' });
  res.json(row);
});

// POST /api/products — เพิ่มสินค้าใหม่
router.post('/', (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const p = {
    sku: req.body.sku.trim(),
    name: req.body.name.trim(),
    category_id: req.body.category_id ? Number(req.body.category_id) : null,
    quantity: Number(req.body.quantity ?? 0),
    unit: (req.body.unit || 'ชิ้น').trim(),
    price: Number(req.body.price ?? 0),
    min_stock: Number(req.body.min_stock ?? 0),
  };
  try {
    const info = db.prepare(`
      INSERT INTO products (sku, name, category_id, quantity, unit, price, min_stock)
      VALUES (@sku, @name, @category_id, @quantity, @unit, @price, @min_stock)
    `).run(p);
    res.status(201).json(db.prepare(SELECT_PRODUCT + ' WHERE p.id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: `รหัสสินค้า ${p.sku} มีอยู่แล้ว` });
    }
    throw err;
  }
});

// PUT /api/products/:id — แก้ไขข้อมูลสินค้า
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'ไม่พบสินค้า' });

  const error = validate(req.body, { partial: true });
  if (error) return res.status(400).json({ error });

  const merged = { ...existing, ...req.body, id: existing.id };
  merged.category_id = merged.category_id ? Number(merged.category_id) : null;
  try {
    db.prepare(`
      UPDATE products SET sku=@sku, name=@name, category_id=@category_id, quantity=@quantity,
             unit=@unit, price=@price, min_stock=@min_stock, updated_at=datetime('now','localtime')
      WHERE id=@id
    `).run({
      id: merged.id, sku: String(merged.sku).trim(), name: String(merged.name).trim(),
      category_id: merged.category_id, quantity: Number(merged.quantity), unit: merged.unit,
      price: Number(merged.price), min_stock: Number(merged.min_stock),
    });
    res.json(db.prepare(SELECT_PRODUCT + ' WHERE p.id = ?').get(existing.id));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'รหัสสินค้านี้มีอยู่แล้ว' });
    }
    throw err;
  }
});

// DELETE /api/products/:id — ลบสินค้า (ประวัติการเคลื่อนไหวจะถูกลบตาม)
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'ไม่พบสินค้า' });
  res.status(204).end();
});

// POST /api/products/:id/stock — รับเข้า (IN) / เบิกออก (OUT) สินค้า
router.post('/:id/stock', (req, res) => {
  const { type, note } = req.body;
  const qty = Number(req.body.quantity);
  if (!['IN', 'OUT'].includes(type)) return res.status(400).json({ error: 'type ต้องเป็น IN หรือ OUT' });
  if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: 'quantity ต้องเป็นจำนวนเต็มมากกว่า 0' });

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'ไม่พบสินค้า' });

  const newQty = type === 'IN' ? product.quantity + qty : product.quantity - qty;
  if (newQty < 0) {
    return res.status(400).json({ error: `สต็อกไม่พอ (คงเหลือ ${product.quantity} ${product.unit})` });
  }

  // ทำสองคำสั่งใน transaction เดียว เพื่อให้ยอดคงเหลือกับประวัติตรงกันเสมอ
  const apply = db.transaction(() => {
    db.prepare(`UPDATE products SET quantity = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(newQty, product.id);
    db.prepare('INSERT INTO stock_movements (product_id, type, quantity, note) VALUES (?, ?, ?, ?)')
      .run(product.id, type, qty, note || null);
  });
  apply();

  res.status(201).json(db.prepare(SELECT_PRODUCT + ' WHERE p.id = ?').get(product.id));
});

// GET /api/products/:id/movements — ประวัติการรับเข้า/เบิกออกของสินค้า
router.get('/:id/movements', (req, res) => {
  const exists = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'ไม่พบสินค้า' });
  const rows = db.prepare(
    'SELECT * FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC, id DESC'
  ).all(req.params.id);
  res.json(rows);
});

module.exports = router;
