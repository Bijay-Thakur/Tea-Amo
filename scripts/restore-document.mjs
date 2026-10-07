import fs from 'node:fs';
import { call, requireConfig } from './supabase-admin.mjs';

requireConfig();
const source = JSON.parse(fs.readFileSync('master-state.json', 'utf8'));
for (const staff of source.staff || []) {
  delete staff.order_pin;
  delete staff.order_pin_hash;
  delete staff.order_pin_salt;
  delete staff.order_pin_iterations;
}
source.setup = true;
source.tableOrders = {};
source.stateUpdatedAt = new Date().toISOString();

const current = await call('/rest/v1/business_documents?name=eq.master&select=revision');
const revision = Number(current?.[0]?.revision || 0);
const next = revision + 1;
const updated = await call(`/rest/v1/business_documents?name=eq.master&revision=eq.${revision}`, {
  method: 'PATCH',
  prefer: 'return=representation',
  body: { revision: next, data: source, updated_at: new Date().toISOString() }
});
if (!updated?.length) throw new Error('The café record changed while restoring. Run this again.');

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
const ingredients = (source.ingredients || []).map((item) => ({ key: item.key, name: item.name, unit: item.unit || '', stock: Number(item.stock || 0), avg_cost: Number(item.avg_cost || 0), record: item }));
const staff = (source.staff || []).map((item) => ({ id: String(item.id), name: item.name, role: item.role || '', phone: item.phone || '', active: item.active !== false, record: { ...item, order_pin: undefined, order_pin_hash: undefined, order_pin_salt: undefined, order_pin_iterations: undefined } }));
await upsert('menu_items', menu, 'id');
await upsert('ingredients', ingredients, 'key');
await upsert('staff', staff, 'id');
console.log(JSON.stringify({ restored: true, revision: next, menu: menu.length, expenses: (source.expenses || []).length, setup: true }));
