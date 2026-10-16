// เชื่อมต่อฐานข้อมูล SQLite และสร้างตารางเมื่อเริ่มรันครั้งแรก
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'inventory.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS products (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sku          TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    quantity     INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    unit         TEXT NOT NULL DEFAULT 'ชิ้น',
    price        REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
    min_stock    INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
    created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('IN','OUT')),
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// ใส่ข้อมูลตัวอย่างถ้ายังไม่มีสินค้าในระบบ
const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
if (count === 0) {
  const addCat = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
  ['อุปกรณ์สำนักงาน', 'อิเล็กทรอนิกส์', 'วัตถุดิบ'].forEach((c) => addCat.run(c));
  const catId = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;

  const addProduct = db.prepare(`
    INSERT INTO products (sku, name, category_id, quantity, unit, price, min_stock)
    VALUES (@sku, @name, @category_id, @quantity, @unit, @price, @min_stock)
  `);
  [
    { sku: 'OF-001', name: 'กระดาษ A4 80 แกรม', category_id: catId('อุปกรณ์สำนักงาน'), quantity: 120, unit: 'รีม', price: 115, min_stock: 30 },
    { sku: 'OF-002', name: 'ปากกาลูกลื่น สีน้ำเงิน', category_id: catId('อุปกรณ์สำนักงาน'), quantity: 15, unit: 'กล่อง', price: 60, min_stock: 20 },
    { sku: 'EL-001', name: 'บอร์ด ESP32 DevKit', category_id: catId('อิเล็กทรอนิกส์'), quantity: 8, unit: 'ชิ้น', price: 189, min_stock: 10 },
    { sku: 'RM-001', name: 'ด้ายฝ้าย 40/1', category_id: catId('วัตถุดิบ'), quantity: 250, unit: 'กิโลกรัม', price: 95, min_stock: 100 },
  ].forEach((p) => addProduct.run(p));
}

module.exports = db;
