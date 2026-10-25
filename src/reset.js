import { rest, rpc } from './supabase.js';
import { verifyOwnerPasswordRecord } from './owner-password.js';

const PHRASE = 'RESET TEA AMO';
const OPERATIONAL_KEYS = [
  'bills', 'attendance', 'purchases', 'waste', 'expenses', 'customers', 'complaints',
  'inventoryLog', 'businessDays', 'auditLog', 'ownerCapital', 'dailyBusinessReports',
  'accountTransfers', 'cart'
];

export function resetPhrase() {
  return PHRASE;
}

export function clearedOperationalState(data = {}) {
  const next = { ...data };
  for (const key of OPERATIONAL_KEYS) next[key] = [];
  next.tableOrders = {};
  next.dashboardBaseline = null;
  next.operationalGeneration = Number(data.operationalGeneration || 1) + 1;
  next.stateUpdatedAt = new Date().toISOString();
  if (Array.isArray(next.ingredients)) {
    next.ingredients = next.ingredients.map((item) => ({ ...item, stock: 0, avg_cost: 0 }));
  }
  if (Array.isArray(next.staff)) {
    next.staff = next.staff.map((item) => ({ ...item, clockIn: null }));
  }
  if (Array.isArray(next.tables)) {
    next.tables = next.tables.map((item) => ({ ...item, attention: false, reservation: null, seated: false }));
  }
  return next;
}

export function resetVerified(before, after) {
  const keys = ['sales', 'sale_items', 'payments', 'live_orders', 'order_items', 'inventory_movements', 'guest_orders'];
  return keys.every((key) => Number(after?.[key] || 0) === 0) && Number(after?.bills || 0) === 0;
}

async function masterRow(env) {
  try {
    const rows = await rest(env, '/rest/v1/business_documents?name=eq.master&select=revision,data,operational_generation');
    return rows?.[0] || null;
  } catch (error) {
    if (!/operational_generation|schema cache|column/i.test(String(error.message || error))) throw error;
    const rows = await rest(env, '/rest/v1/business_documents?name=eq.master&select=revision,data');
    return rows?.[0] || null;
  }
}

export async function previewOperationalReset(env) {
  let counts = {};
  try {
    counts = await rpc(env, 'reset_operational_preview', {});
  } catch {
    counts = {};
  }
  const row = await masterRow(env);
  const data = row?.data || {};
  return {
    generation: Number(row?.operational_generation || data.operationalGeneration || 1),
    revision: Number(row?.revision || 0),
    counts: {
      sales: Number(counts.sales ?? 0),
      sale_items: Number(counts.sale_items ?? 0),
      payments: Number(counts.payments ?? 0),
      live_orders: Number(counts.live_orders ?? 0),
      order_items: Number(counts.order_items ?? 0),
      inventory_movements: Number(counts.inventory_movements ?? 0),
      guest_orders: Number(counts.guest_orders ?? 0),
      bills: Array.isArray(data.bills) ? data.bills.length : 0,
      attendance: Array.isArray(data.attendance) ? data.attendance.length : 0,
      expenses: Array.isArray(data.expenses) ? data.expenses.length : 0,
      purchases: Array.isArray(data.purchases) ? data.purchases.length : 0,
      customers: Array.isArray(data.customers) ? data.customers.length : 0
    },
    preserved: ['menu', 'recipes', 'staff_profiles', 'vendors', 'business_settings', 'payment_methods', 'payment_qr', 'owner_password', 'storefront_settings']
  };
}

export async function runOperationalReset(env, { password, phrase, actor }) {
  if (String(phrase || '').trim() !== PHRASE) {
    const error = new Error('Type RESET TEA AMO exactly to continue.');
    error.status = 400;
    throw error;
  }
  const row = await masterRow(env);
  if (!row?.data) {
    const error = new Error('The café record is not available.');
    error.status = 409;
    throw error;
  }
  const ok = await verifyOwnerPasswordRecord(password, row.data.passwordAuth, row.data.passwordHash);
  if (!ok) {
    const error = new Error('Incorrect owner password.');
    error.status = 403;
    throw error;
  }
  const nextData = clearedOperationalState(row.data);
  let result;
  try {
    result = await rpc(env, 'reset_operational_data', {
      p_next_data: nextData,
      p_expected_revision: Number(row.revision || 0),
      p_actor_id: actor?.id || null,
      p_actor_name: actor?.display_name || 'Administration'
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('reset_not_verified')) {
      const rolledBack = new Error('Reset did not finish and was rolled back. No operational data was changed.');
      rolledBack.status = 409;
      throw rolledBack;
    }
    error.status = error.status || 500;
    throw error;
  }
  if (!result?.ok || !result?.verified) {
    const error = new Error(result?.error || 'Reset did not finish. No success was recorded.');
    error.status = 409;
    error.result = result;
    throw error;
  }
  return result;
}

export async function saveDashboardBaseline(env, baseline) {
  const row = await masterRow(env);
  if (!row?.data) {
    const error = new Error('The café record is not available.');
    error.status = 409;
    throw error;
  }
  const data = { ...row.data, dashboardBaseline: baseline, stateUpdatedAt: new Date().toISOString() };
  const updated = await rest(env, `/rest/v1/business_documents?name=eq.master&revision=eq.${Number(row.revision || 0)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { revision: Number(row.revision || 0) + 1, data, updated_at: new Date().toISOString() }
  });
  if (!updated?.length) {
    const error = new Error('The café record changed on another screen. Reload and try again.');
    error.status = 409;
    throw error;
  }
  return { revision: Number(updated[0].revision), baseline };
}
