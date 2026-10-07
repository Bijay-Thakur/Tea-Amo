import fs from 'node:fs';
import path from 'node:path';
import { call, requireConfig } from './supabase-admin.mjs';

requireConfig();
const root = process.cwd();
const sourcePath = path.join(root, 'master-state.json');
const lanPath = path.join(root, 'lan-state.json');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const lan = fs.existsSync(lanPath) ? JSON.parse(fs.readFileSync(lanPath, 'utf8')) : { orders: {} };

fs.mkdirSync(path.join(root, 'backups'), { recursive: true });
const backupPath = path.join(root, 'backups', 'master-state.pre-cloud.json');
if (!fs.existsSync(backupPath)) fs.copyFileSync(sourcePath, backupPath);

function strip(state) {
  const copy = structuredClone(state);
  for (const staff of copy.staff || []) {
    delete staff.order_pin;
    delete staff.order_pin_hash;
    delete staff.order_pin_salt;
    delete staff.order_pin_iterations;
  }
  return copy;
}

async function upsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    if (!chunk.length) continue;
    await call(`/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: chunk
    });
  }
}

const menu = (source.menu || []).map((item) => ({ id: String(item.id), name: item.name, category: item.category || 'Menu', price: Number(item.price || 0), active: item.active !== false }));
const tables = (source.tables || []).map((table) => ({
  id: String(table.id), name: table.name, seats: Math.max(1, Number(table.seats || 1)),
  x: Number(table.x || 0), y: Number(table.y || 0), w: Number(table.w || 10), h: Number(table.h || 10),
  kind: table.kind || 'regular', active: table.active !== false, attention: !!table.attention, reservation: table.reservation || null
}));
const ingredients = (source.ingredients || []).map((item) => ({ key: item.key, name: item.name, unit: item.unit || '', stock: Number(item.stock || 0), avg_cost: Number(item.avg_cost || 0), record: item }));
const staff = (source.staff || []).map((item) => ({ id: String(item.id), name: item.name, role: item.role || '', phone: item.phone || '', active: item.active !== false, record: { ...item, order_pin: undefined, order_pin_hash: undefined, order_pin_salt: undefined, order_pin_iterations: undefined } }));
const recipes = [];
for (const [name, lines] of Object.entries(source.recipes || {})) {
  for (const line of lines || []) {
    if (!line?.ingredient_key || !(Number(line.qty) > 0)) continue;
    recipes.push({ menu_name: name, ingredient_key: line.ingredient_key, qty: Number(line.qty) });
  }
}

await upsert('menu_items', menu, 'id');
await upsert('cafe_tables', tables, 'id');
await upsert('ingredients', ingredients, 'key');
await upsert('staff', staff, 'id');
await call('/rest/v1/recipes?menu_name=not.is.null', { method: 'DELETE', prefer: 'return=minimal' });
await upsert('recipes', recipes, 'menu_name,ingredient_key');

let salesInserted = 0;
let salesExisting = 0;
for (const bill of source.bills || []) {
  const idempotency = `legacy:${bill.id}`;
  const found = await call(`/rest/v1/sales?idempotency_key=eq.${encodeURIComponent(idempotency)}&select=id`);
  if (found?.length) { salesExisting += 1; continue; }
  await call('/rest/v1/sales', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      id: String(bill.id),
      table_id: bill.table_id || null,
      business_day: bill.businessDay || null,
      total: Number(bill.total || 0),
      payment: bill.payment || '',
      bill,
      result: { ok: true, replayed: false, bill, legacy: true },
      actor_role: 'admin',
      actor_name: bill.completed_by_staff || 'legacy',
      idempotency_key: idempotency
    }
  });
  const items = (bill.items || []).map((item) => ({
    sale_id: String(bill.id),
    menu_item_id: item.id == null ? null : String(item.id),
    name: item.name,
    unit_price: Number(item.price || 0),
    qty: Number(item.qty || 0),
    served_qty: Number(item.served_qty || 0),
    cogs: Number(item.cogs || 0)
  }));
  if (items.length) await call('/rest/v1/sale_items', { method: 'POST', prefer: 'return=minimal', body: items });
  await call('/rest/v1/payments', {
    method: 'POST',
    prefer: 'return=minimal',
    body: { sale_id: String(bill.id), idempotency_key: idempotency, method: bill.payment || 'Cash', amount: Number(bill.total || 0), breakdown: bill.payments || {} }
  });
  salesInserted += 1;
}

const existingDoc = await call('/rest/v1/business_documents?name=eq.master&select=revision');
if (!existingDoc?.length) {
  await call('/rest/v1/business_documents', { method: 'POST', prefer: 'return=minimal', body: { name: 'master', revision: 1, data: strip(source) } });
}

for (const [tableId, row] of Object.entries(lan.orders || {})) {
  const cart = row?.order?.cart || [];
  if (!cart.length) continue;
  const current = await call(`/rest/v1/live_orders?table_id=eq.${encodeURIComponent(tableId)}&select=table_id`);
  if (current?.length) continue;
  await call('/rest/v1/live_orders', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      table_id: tableId,
      version: Number(row.version || 1),
      attention: !!row.attention,
      guest_count: Number(row.order.guestCount || 1),
      discount_type: row.order.discountType || 'percent',
      discount_value: Number(row.order.discountValue || 0),
      opened_at: row.order.openedAt,
      order_ref: row.order.orderRef || '',
      order_type: row.order.orderType || 'Dine-in'
    }
  });
  await call('/rest/v1/order_items', {
    method: 'POST',
    prefer: 'return=minimal',
    body: cart.filter((item) => Number(item.qty) > 0).map((item) => ({
      table_id: tableId,
      menu_item_id: String(item.id),
      name: source.menu.find((menu) => String(menu.id) === String(item.id))?.name || 'Item',
      unit_price: Number(source.menu.find((menu) => String(menu.id) === String(item.id))?.price || 0),
      qty: Number(item.qty),
      served_qty: Number(item.served || 0)
    }))
  });
}

const [menuRows, staffRows, ingredientRows, tableRows, salesRows] = await Promise.all([
  call('/rest/v1/menu_items?select=id'),
  call('/rest/v1/staff?select=id'),
  call('/rest/v1/ingredients?select=key,stock'),
  call('/rest/v1/cafe_tables?select=id'),
  call('/rest/v1/sales?select=total')
]);
const doc = (await call('/rest/v1/business_documents?name=eq.master&select=data'))[0].data;
const salesTotal = (salesRows || []).reduce((sum, row) => sum + Number(row.total || 0), 0);
const sourceSales = (source.bills || []).reduce((sum, bill) => sum + Number(bill.total || 0), 0);
const report = {
  migrated_at: new Date().toISOString(),
  backup: backupPath,
  sales_inserted: salesInserted,
  sales_already_present: salesExisting,
  legacy_files_kept: ['master-state.json', 'lan-state.json'],
  counts: {
    menu: { source: (source.menu || []).length, database: menuRows.length },
    staff: { source: (source.staff || []).length, database: staffRows.length },
    attendance: { source: (source.attendance || []).length, document: (doc.attendance || []).length },
    bills: { source: (source.bills || []).length, database: salesRows.length },
    sales_total: { source: Math.round(sourceSales * 100) / 100, database: Math.round(salesTotal * 100) / 100 },
    inventory: { source: (source.ingredients || []).length, database: ingredientRows.length },
    vendors: { source: (source.vendors || []).length, document: (doc.vendors || []).length },
    expenses: { source: (source.expenses || []).length, document: (doc.expenses || []).length },
    customers: { source: (source.customers || []).length, document: (doc.customers || []).length },
    tables: { source: (source.tables || []).length, database: tableRows.length }
  }
};
const mismatches = Object.entries(report.counts).filter(([, value]) => {
  const numbers = Object.values(value).filter((item) => typeof item === 'number');
  return new Set(numbers.map((item) => Math.round(item * 100))).size > 1;
});
report.ok = mismatches.length === 0;
report.mismatches = mismatches.map(([name]) => name);
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
const reportPath = path.join(root, 'reports', 'migration-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(2);
