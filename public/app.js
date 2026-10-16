// ===== ตัวช่วยเรียก API =====
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}

const $ = (sel) => document.querySelector(sel);
const fmt = (n, digits = 0) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let categories = [];
let editingId = null;   // id ของสินค้าที่กำลังแก้ไข (null = เพิ่มใหม่)
let stockProduct = null; // สินค้าที่กำลังปรับสต็อก

// ===== โหลดข้อมูล =====
async function loadSummary() {
  const s = await api('/api/summary');
  $('#s-products').textContent = fmt(s.total_products);
  $('#s-units').textContent = fmt(s.total_units);
  $('#s-value').textContent = fmt(s.total_value, 2);
  $('#s-low').textContent = fmt(s.low_stock_count);
}

async function loadCategories() {
  categories = await api('/api/categories');
  const options = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const current = $('#filter-category').value;
  $('#filter-category').innerHTML = `<option value="">ทุกหมวดหมู่</option>${options}`;
  $('#filter-category').value = current;
  $('#form-category').innerHTML = `<option value="">— ไม่ระบุ —</option>${options}`;
  $('#category-list').innerHTML = categories.map((c) => `
    <li><span>${escapeHtml(c.name)} <span class="muted">(${c.product_count} รายการ)</span></span>
        <button type="button" class="small danger" data-del-cat="${c.id}">ลบ</button></li>`).join('');
}

async function loadProducts() {
  const params = new URLSearchParams();
  if ($('#search').value.trim()) params.set('search', $('#search').value.trim());
  if ($('#filter-category').value) params.set('category', $('#filter-category').value);
  if ($('#filter-low').checked) params.set('lowStock', 'true');

  const products = await api(`/api/products?${params}`);
  $('#empty').hidden = products.length > 0;
  $('#product-rows').innerHTML = products.map((p) => `
    <tr class="${p.is_low_stock ? 'low' : ''}">
      <td>${escapeHtml(p.sku)}</td>
      <td>${escapeHtml(p.name)}${p.is_low_stock ? '<span class="badge">ใกล้หมด</span>' : ''}</td>
      <td>${escapeHtml(p.category_name || '—')}</td>
      <td class="num qty">${fmt(p.quantity)} ${escapeHtml(p.unit)}</td>
      <td class="num">${fmt(p.min_stock)}</td>
      <td class="num">${fmt(p.price, 2)}</td>
      <td class="row-actions">
        <button class="small" data-stock="${p.id}">รับ/เบิก</button>
        <button class="small" data-edit="${p.id}">แก้ไข</button>
        <button class="small danger" data-delete="${p.id}">ลบ</button>
      </td>
    </tr>`).join('');
}

async function refresh() {
  await Promise.all([loadSummary(), loadProducts()]);
}

// ===== เพิ่ม/แก้ไขสินค้า =====
async function openProductDialog(id = null) {
  editingId = id;
  const form = $('#product-form');
  form.reset();
  $('#product-error').textContent = '';
  $('#product-dialog-title').textContent = id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า';
  form.quantity.disabled = Boolean(id); // แก้จำนวนผ่านการรับ/เบิกเท่านั้น เพื่อให้มีประวัติ
  if (id) {
    const p = await api(`/api/products/${id}`);
    for (const key of ['sku', 'name', 'unit', 'quantity', 'min_stock', 'price']) form[key].value = p[key];
    form.category_id.value = p.category_id ?? '';
  }
  $('#product-dialog').showModal();
}

$('#product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form));
  if (editingId) delete body.quantity;
  try {
    if (editingId) await api(`/api/products/${editingId}`, { method: 'PUT', body });
    else await api('/api/products', { method: 'POST', body });
    $('#product-dialog').close();
    await Promise.all([refresh(), loadCategories()]);
  } catch (err) {
    $('#product-error').textContent = err.message;
  }
});

// ===== รับเข้า/เบิกออก =====
async function openStockDialog(id) {
  stockProduct = await api(`/api/products/${id}`);
  $('#stock-form').reset();
  $('#stock-error').textContent = '';
  $('#stock-title').textContent = `${stockProduct.sku} · ${stockProduct.name}`;
  $('#stock-current').textContent = `คงเหลือ ${fmt(stockProduct.quantity)} ${stockProduct.unit}`;
  await loadMovements();
  $('#stock-dialog').showModal();
}

async function loadMovements() {
  const rows = await api(`/api/products/${stockProduct.id}/movements`);
  $('#movements').innerHTML = rows.length
    ? rows.map((m) => `
        <li><span>${m.created_at}${m.note ? ` · ${escapeHtml(m.note)}` : ''}</span>
            <span class="${m.type === 'IN' ? 'in' : 'out'}">${m.type === 'IN' ? '+' : '−'}${fmt(m.quantity)}</span></li>`).join('')
    : '<li class="muted">ยังไม่มีประวัติ</li>';
}

$('#stock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  body.quantity = Number(body.quantity);
  try {
    stockProduct = await api(`/api/products/${stockProduct.id}/stock`, { method: 'POST', body });
    $('#stock-current').textContent = `คงเหลือ ${fmt(stockProduct.quantity)} ${stockProduct.unit}`;
    e.target.reset();
    $('#stock-error').textContent = '';
    await Promise.all([loadMovements(), refresh()]);
  } catch (err) {
    $('#stock-error').textContent = err.message;
  }
});

// ===== หมวดหมู่ =====
$('#category-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/categories', { method: 'POST', body: { name: e.target.name.value } });
    e.target.reset();
    $('#category-error').textContent = '';
    await loadCategories();
  } catch (err) {
    $('#category-error').textContent = err.message;
  }
});

$('#category-list').addEventListener('click', async (e) => {
  const id = e.target.dataset.delCat;
  if (!id || !confirm('ลบหมวดหมู่นี้? สินค้าในหมวดจะกลายเป็น "ไม่ระบุ"')) return;
  await api(`/api/categories/${id}`, { method: 'DELETE' });
  await Promise.all([loadCategories(), loadProducts()]);
});

// ===== ปุ่มในตาราง =====
$('#product-rows').addEventListener('click', async (e) => {
  const { stock, edit, delete: del } = e.target.dataset;
  if (stock) openStockDialog(stock);
  if (edit) openProductDialog(edit);
  if (del && confirm('ต้องการลบสินค้านี้ใช่หรือไม่?')) {
    await api(`/api/products/${del}`, { method: 'DELETE' });
    await Promise.all([refresh(), loadCategories()]);
  }
});

// ===== อื่น ๆ =====
$('#btn-new').addEventListener('click', () => openProductDialog());
$('#btn-categories').addEventListener('click', () => $('#category-dialog').showModal());
document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => b.closest('dialog').close()));

let searchTimer;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadProducts, 250);
});
$('#filter-category').addEventListener('change', loadProducts);
$('#filter-low').addEventListener('change', loadProducts);

loadCategories().then(refresh).catch((err) => alert(err.message));
