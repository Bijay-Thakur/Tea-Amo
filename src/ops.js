import { rest, rpc, authAdmin } from './supabase.js';

const PRESENCE_MS = 90 * 1000;
const SERVER_EMAIL_DOMAIN = 'servers.teaamo.local';

export function serverEmail(username) {
  return `${String(username).trim().toLowerCase()}@${SERVER_EMAIL_DOMAIN}`;
}

export function validUsername(value) {
  return /^[a-z][a-z0-9._-]{2,30}$/.test(String(value || '').trim().toLowerCase());
}

export function validPassword(value) {
  return String(value || '').length >= 8 && String(value || '').length <= 128;
}

export function rpcStatus(error) {
  const message = String(error?.message || error?.data?.message || '');
  if (message.includes('order_version_conflict')) return { status: 409, error: 'Order changed on another device. Refresh and try again.', code: 'conflict' };
  if (message.includes('forbidden')) return { status: 403, error: 'Not allowed' };
  if (message.includes('business_day_finalized')) return { status: 409, error: 'This business day is finalized' };
  if (message.includes('pos_closed')) return { status: 409, error: 'POS is closed' };
  if (message.includes('invalid_selection')) return { status: 409, error: 'Those items are no longer on the order' };
  if (message.includes('order_missing')) return { status: 409, error: 'This table has no open order' };
  if (message.includes('unknown_menu_item')) return { status: 400, error: 'That menu item is not available' };
  if (message.includes('unknown_table')) return { status: 404, error: 'Unknown table' };
  if (message.includes('empty_payment')) return { status: 400, error: 'Add at least one item' };
  return { status: error.status || 500, error: message || 'Request failed' };
}

export function publicProfile(profile) {
  return {
    id: profile.id,
    role: profile.role,
    display_name: profile.display_name,
    username: profile.username,
    staff_id: profile.staff_id,
    active: profile.active
  };
}

export function stripStaffSecrets(state) {
  for (const staff of state?.staff || []) {
    delete staff.order_pin;
    delete staff.order_pin_hash;
    delete staff.order_pin_salt;
    delete staff.order_pin_iterations;
  }
  return state;
}

function numId(id) {
  return /^[0-9]+$/.test(String(id)) ? Number(id) : id;
}

export function clientOrder(row) {
  const items = row.order_items || [];
  return {
    cart: items.map((item) => ({ id: numId(item.menu_item_id), qty: item.qty, served: item.served_qty })),
    openedAt: row.opened_at,
    customerId: null,
    discountType: row.discount_type || 'percent',
    discountValue: Number(row.discount_value || 0),
    orderRef: row.order_ref || '',
    orderType: row.order_type || 'Dine-in',
    guestCount: row.guest_count || 1,
    _lan_version: row.version,
    _lan_updated_by: row.updated_by_name || ''
  };
}

async function paged(env, path) {
  const rows = [];
  for (let from = 0; from < 20000; from += 1000) {
    const page = await rest(env, `${path}${path.includes('?') ? '&' : '?'}offset=${from}&limit=1000`);
    rows.push(...(page || []));
    if (!page || page.length < 1000) break;
  }
  return rows;
}

export async function loadOperational(env) {
  const [orders, tables, stocks, sales] = await Promise.all([
    rest(env, '/rest/v1/live_orders?select=*,order_items(menu_item_id,name,unit_price,qty,served_qty)'),
    rest(env, '/rest/v1/cafe_tables?select=*'),
    rest(env, '/rest/v1/ingredients?select=key,stock,avg_cost'),
    paged(env, '/rest/v1/sales?select=id,bill,created_at&order=created_at.asc')
  ]);
  return { orders: orders || [], tables: tables || [], stocks: stocks || [], sales: sales || [] };
}

export function projectState(document, operational) {
  const state = document?.data || {};
  state.bills = Array.isArray(state.bills) ? state.bills : [];
  const have = new Set(state.bills.map((bill) => bill.id));
  for (const sale of operational.sales) {
    if (sale.bill && !have.has(sale.bill.id || sale.id)) state.bills.unshift(sale.bill);
  }
  const stockByKey = new Map(operational.stocks.map((row) => [row.key, row]));
  for (const ingredient of state.ingredients || []) {
    const row = stockByKey.get(ingredient.key);
    if (!row) continue;
    ingredient.stock = Number(row.stock);
    ingredient.avg_cost = Number(row.avg_cost);
  }
  const tableById = new Map((operational.tables || []).map((table) => [table.id, table]));
  for (const table of state.tables || []) {
    const row = tableById.get(table.id);
    if (!row) continue;
    table.attention = !!row.attention;
    table.reservation = row.reservation || null;
    table.seated = !!row.seated;
    table.active = row.active !== false;
    table.seats = row.seats;
  }
  state.tableOrders = {};
  for (const order of operational.orders) state.tableOrders[order.table_id] = clientOrder(order);
  stripStaffSecrets(state);
  return state;
}

function recipeRows(recipes) {
  const rows = [];
  for (const [name, lines] of Object.entries(recipes || {})) {
    for (const line of lines || []) {
      if (!line?.ingredient_key || !(Number(line.qty) > 0)) continue;
      rows.push({ menu_name: name, ingredient_key: line.ingredient_key, qty: Number(line.qty) });
    }
  }
  return rows;
}

function deductMissingSales(state, sales) {
  const have = new Set((state.bills || []).map((bill) => bill.id));
  const missing = sales.filter((sale) => sale.bill && !have.has(sale.bill.id || sale.id));
  const ingredients = new Map((state.ingredients || []).map((row) => [row.key, row]));
  for (const sale of missing) {
    state.bills.unshift(sale.bill);
    for (const item of sale.bill.items || []) {
      const lines = state.recipes?.[item.name] || [];
      for (const line of lines) {
        const ingredient = ingredients.get(line.ingredient_key);
        if (!ingredient) continue;
        const used = Number(line.qty || 0) * Number(item.qty || 0);
        ingredient.stock = Number(ingredient.stock || 0) - used;
        state.inventoryLog = state.inventoryLog || [];
        state.inventoryLog.unshift({
          id: `sale-${sale.bill.id}-${line.ingredient_key}`,
          time: sale.bill.time,
          ingredient_key: line.ingredient_key,
          qty_delta: -used,
          reason: 'sale',
          ref: sale.bill.id,
          note: item.name
        });
      }
    }
  }
  return missing.length;
}

export async function saveMaster(env, incoming, expectedRevision) {
  const current = await rest(env, '/rest/v1/business_documents?name=eq.master&select=revision,data');
  const row = current?.[0];
  const revision = Number(row?.revision || 0);
  if (expectedRevision != null && Number(expectedRevision) !== revision && revision !== 0) {
    const error = new Error('state_revision_conflict');
    error.status = 409;
    throw error;
  }
  const operational = await loadOperational(env);
  deductMissingSales(incoming, operational.sales);
  stripStaffSecrets(incoming);
  incoming.tableOrders = {};
  for (const order of operational.orders) incoming.tableOrders[order.table_id] = clientOrder(order);
  const nextRevision = revision + 1;
  incoming.stateUpdatedAt = new Date().toISOString();
  if (row) {
    const updated = await rest(env, `/rest/v1/business_documents?name=eq.master&revision=eq.${revision}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: { revision: nextRevision, data: incoming, updated_at: new Date().toISOString() }
    });
    if (!updated?.length) {
      const error = new Error('state_revision_conflict');
      error.status = 409;
      throw error;
    }
  } else {
    await rest(env, '/rest/v1/business_documents', {
      method: 'POST',
      prefer: 'return=minimal',
      body: { name: 'master', revision: 1, data: incoming }
    });
  }
  await syncCatalog(env, incoming);
  return { revision: row ? nextRevision : 1 };
}

async function upsert(env, table, rows, onConflict) {
  const size = 200;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    if (!chunk.length) continue;
    await rest(env, `/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: chunk
    });
  }
}

export async function syncCatalog(env, state) {
  const menu = (state.menu || []).map((item) => ({
    id: String(item.id),
    name: item.name,
    category: item.category || 'Menu',
    price: Number(item.price || 0),
    active: item.active !== false
  }));
  const tables = (state.tables || []).map((table) => ({
    id: String(table.id),
    name: table.name,
    seats: Math.max(1, Number(table.seats || 1)),
    x: Number(table.x || 0),
    y: Number(table.y || 0),
    w: Number(table.w || 10),
    h: Number(table.h || 10),
    kind: table.kind || 'regular',
    active: table.active !== false,
    attention: !!table.attention,
    reservation: table.reservation || null
  }));
  const ingredients = (state.ingredients || []).map((item) => ({
    key: item.key,
    name: item.name,
    unit: item.unit || '',
    stock: Number(item.stock || 0),
    avg_cost: Number(item.avg_cost || 0),
    record: item
  }));
  const staff = (state.staff || []).map((item) => ({
    id: String(item.id),
    name: item.name,
    role: item.role || '',
    phone: item.phone || '',
    active: item.active !== false,
    record: { ...item, order_pin: undefined, order_pin_hash: undefined, order_pin_salt: undefined, order_pin_iterations: undefined }
  }));
  await upsert(env, 'menu_items', menu, 'id');
  await upsert(env, 'cafe_tables', tables, 'id');
  await upsert(env, 'ingredients', ingredients, 'key');
  await upsert(env, 'staff', staff, 'id');
  await rest(env, '/rest/v1/recipes?menu_name=not.is.null', { method: 'DELETE', prefer: 'return=minimal' });
  await upsert(env, 'recipes', recipeRows(state.recipes), 'menu_name,ingredient_key');
}

export async function workspaceForServer(env, token, profile) {
  const [menu, tables, orders, docRows] = await Promise.all([
    rest(env, '/rest/v1/menu_items?active=eq.true&select=id,name,category,price&order=name.asc', { token }),
    rest(env, '/rest/v1/cafe_tables?active=eq.true&select=id,name,seats,x,y,w,h,kind,attention,reservation,seated&order=name.asc', { token }),
    rest(env, '/rest/v1/live_orders?select=table_id,version,attention,guest_count,discount_type,discount_value,opened_at,order_ref,order_type,updated_by_name,updated_at,order_items(menu_item_id,qty,served_qty)', { token }),
    rest(env, '/rest/v1/business_documents?name=eq.master&select=data')
  ]);
  const business = docRows?.[0]?.data?.business || {};
  const methods = (business.payment_methods || []).map((item) => (typeof item === 'string' ? item : item.name)).filter(Boolean);
  return {
    staff: { id: profile.staff_id, name: profile.display_name, role: 'server_staff' },
    business: {
      name: business.name || 'TEA AMO',
      branch: business.branch || '',
      currency: business.currency || 'Rs',
      taxRate: Number(business.taxRate || 0),
      payment_methods: methods.length ? methods : ['Cash'],
      payment_qr: business.payment_qr || {}
    },
    menu: (menu || []).map((item) => ({ ...item, id: numId(item.id), price: Number(item.price) })),
    tables: tables || [],
    orders: Object.fromEntries((orders || []).map((order) => [order.table_id, {
      version: order.version,
      attention: order.attention,
      order: clientOrder(order)
    }]))
  };
}

export async function orderPayload(env, tableId, token) {
  const rows = await rest(env, `/rest/v1/live_orders?table_id=eq.${encodeURIComponent(tableId)}&select=*,order_items(menu_item_id,qty,served_qty)`, { token });
  const row = rows?.[0];
  if (!row) return { version: 0, order: null, attention: false };
  return { version: row.version, attention: row.attention, order: clientOrder(row), updated_by: row.updated_by_name || '' };
}

export function orderArgs(tableId, body) {
  const items = Array.isArray(body.items) ? body.items : cartItems(body.order);
  return {
    p_table_id: tableId,
    p_expected_version: Number(body.expected_version ?? body.order?._lan_version ?? 0),
    p_attention: !!body.attention,
    p_guest_count: Math.max(1, Number(body.guest_count ?? body.order?.guestCount ?? 1)),
    p_discount_type: body.discount_type || body.order?.discountType || 'percent',
    p_discount_value: Number(body.discount_value ?? body.order?.discountValue ?? 0),
    p_opened_at: body.opened_at || body.order?.openedAt || null,
    p_order_ref: body.order_ref || body.order?.orderRef || '',
    p_order_type: body.order_type || body.order?.orderType || 'Dine-in',
    p_items: items.map((item) => ({
      menu_item_id: String(item.menu_item_id ?? item.id),
      qty: Number(item.qty || 0),
      served_qty: Number(item.served_qty ?? item.served ?? 0)
    })).filter((item) => item.qty > 0)
  };
}

function cartItems(order) {
  return (order?.cart || []).map((item) => ({ menu_item_id: item.id, qty: item.qty, served_qty: item.served || 0 }));
}

export async function saveOrder(env, token, tableId, body) {
  const result = await rpc(env, 'save_table_order', orderArgs(tableId, body), token);
  return result;
}

export async function completePayment(env, token, body) {
  const result = await rpc(env, 'complete_payment', {
    p_idempotency_key: String(body.idempotency_key || ''),
    p_table_id: body.table_id || null,
    p_expected_version: body.expected_version == null ? 0 : Number(body.expected_version),
    p_items: (body.items || []).map((item) => ({ menu_item_id: String(item.menu_item_id ?? item.id), qty: Number(item.qty || 0) })),
    p_payment: body.payment || 'Cash',
    p_payments: body.payments || {},
    p_cash_received: Number(body.cash_received || 0),
    p_change_due: Number(body.change_due || 0),
    p_non_chargeable: !!body.non_chargeable,
    p_non_chargeable_reason: body.non_chargeable_reason || '',
    p_non_chargeable_note: body.non_chargeable_note || '',
    p_customer_id: body.customer_id ? String(body.customer_id) : null,
    p_order_type: body.order_type || null,
    p_order_ref: body.order_ref || '',
    p_guest_count: Number(body.guest_count || 1),
    p_discount_type: body.discount_type || 'percent',
    p_discount_value: Number(body.discount_value || 0),
    p_opened_at: body.opened_at || null,
    p_business_day: body.business_day || null,
    p_time: body.time || null
  }, token);
  if (body.table_id && result?.table_closed !== false) {
    await rest(env, `/rest/v1/cafe_tables?id=eq.${encodeURIComponent(body.table_id)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { seated: false }
    }).catch(() => {});
  }
  const stocks = await rest(env, '/rest/v1/ingredients?select=key,stock,avg_cost');
  let order = null;
  if (body.table_id && !result.table_closed) order = await orderPayload(env, body.table_id, token);
  return { ...result, stocks: stocks || [], order };
}

async function tableRow(env, tableId) {
  const rows = await rest(env, `/rest/v1/cafe_tables?id=eq.${encodeURIComponent(tableId)}&select=id,name`);
  return rows?.[0] || null;
}

export async function seatTable(env, tableId, seated, profile) {
  const table = await tableRow(env, tableId);
  if (!table) throw Object.assign(new Error('Unknown table'), { status: 404 });
  if (!seated) {
    const items = await rest(env, `/rest/v1/order_items?table_id=eq.${encodeURIComponent(tableId)}&select=qty`);
    if ((items || []).some((item) => Number(item.qty) > 0)) {
      throw Object.assign(new Error(`${table.name} still has an open order. Take payment before marking it as left.`), { status: 409 });
    }
  }
  await rest(env, `/rest/v1/cafe_tables?id=eq.${encodeURIComponent(tableId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { seated: !!seated }
  });
  await rest(env, '/rest/v1/audit_events', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      actor_id: profile?.id || null,
      actor_role: profile?.role || 'server_staff',
      actor_name: profile?.display_name || '',
      action: seated ? 'TABLE_OCCUPIED' : 'TABLE_LEFT',
      entity: 'cafe_table',
      entity_id: tableId,
      metadata: { name: table.name }
    }
  });
  return { ok: true, id: tableId, name: table.name, seated: !!seated };
}

export async function setTableAttention(env, tableId, attention, profile) {
  const table = await tableRow(env, tableId);
  if (!table) throw Object.assign(new Error('Unknown table'), { status: 404 });
  await rest(env, `/rest/v1/cafe_tables?id=eq.${encodeURIComponent(tableId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { attention: !!attention }
  });
  await rest(env, '/rest/v1/audit_events', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      actor_id: profile?.id || null,
      actor_role: profile?.role || 'server_staff',
      actor_name: profile?.display_name || '',
      action: attention ? 'TABLE_ATTENTION' : 'TABLE_ATTENTION_CLEARED',
      entity: 'cafe_table',
      entity_id: tableId,
      metadata: { name: table.name }
    }
  });
  return { ok: true, id: tableId, name: table.name, attention: !!attention };
}

export async function reserveTable(env, tableId, reservation, profile) {
  const table = await tableRow(env, tableId);
  if (!table) throw Object.assign(new Error('Unknown table'), { status: 404 });
  let value = null;
  if (reservation) {
    const guest = String(reservation.guest || '').trim();
    if (!guest) throw Object.assign(new Error('Guest name is required.'), { status: 400 });
    value = {
      guest,
      phone: String(reservation.phone || '').trim(),
      time: reservation.time || '',
      party: Math.max(1, Number(reservation.party || 1)),
      note: String(reservation.note || '').trim(),
      createdAt: new Date().toISOString()
    };
  }
  await rest(env, `/rest/v1/cafe_tables?id=eq.${encodeURIComponent(tableId)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { reservation: value }
  });
  await rest(env, '/rest/v1/audit_events', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      actor_id: profile?.id || null,
      actor_role: profile?.role || 'server_staff',
      actor_name: profile?.display_name || '',
      action: value ? 'TABLE_RESERVED' : 'TABLE_RESERVATION_CLEARED',
      entity: 'cafe_table',
      entity_id: tableId,
      metadata: { name: table.name, guest: value?.guest || null }
    }
  });
  return { ok: true, id: tableId, name: table.name, reservation: value };
}

export async function listServers(env) {
  const [profiles, docRows] = await Promise.all([
    rest(env, '/rest/v1/profiles?role=eq.server_staff&select=*&order=display_name.asc'),
    rest(env, '/rest/v1/business_documents?name=eq.master&select=data')
  ]);
  const staff = docRows?.[0]?.data?.staff || [];
  const now = Date.now();
  return (profiles || []).map((profile) => {
    const linked = staff.find((item) => String(item.id) === String(profile.staff_id));
    const seen = profile.last_seen_at ? new Date(profile.last_seen_at).getTime() : 0;
    return {
      ...publicProfile(profile),
      created_at: profile.created_at,
      last_login_at: profile.last_login_at,
      last_seen_at: profile.last_seen_at,
      presence: seen && now - seen <= PRESENCE_MS ? 'online' : 'offline',
      duty: linked?.clockIn ? 'on_duty' : 'off_duty',
      staff_name: linked?.name || null,
      staff_role: linked?.role || null
    };
  });
}

export async function createServerAccount(env, body) {
  const username = String(body.username || '').trim().toLowerCase();
  const displayName = String(body.display_name || '').trim();
  if (!validUsername(username)) throw Object.assign(new Error('Username must be 3–31 characters and start with a letter.'), { status: 400 });
  if (!displayName) throw Object.assign(new Error('Name is required.'), { status: 400 });
  if (!validPassword(body.password)) throw Object.assign(new Error('Initial password must be at least 8 characters.'), { status: 400 });
  const existing = await rest(env, `/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id`);
  if (existing?.length) throw Object.assign(new Error('That username is already in use.'), { status: 409 });
  const created = await authAdmin(env, '/users', {
    method: 'POST',
    body: {
      email: serverEmail(username),
      password: body.password,
      email_confirm: true,
      user_metadata: { username, display_name: displayName, role: 'server_staff' }
    }
  });
  try {
    await rest(env, '/rest/v1/profiles', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        id: created.id,
        role: 'server_staff',
        display_name: displayName,
        username,
        staff_id: body.staff_id ? String(body.staff_id) : null,
        active: true
      }
    });
  } catch (error) {
    await authAdmin(env, `/users/${created.id}`, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
  await rest(env, '/rest/v1/audit_events', {
    method: 'POST',
    prefer: 'return=minimal',
    body: { action: 'SERVER_CREATED', entity: 'profile', entity_id: created.id, actor_role: 'admin', metadata: { username, staff_id: body.staff_id || null } }
  });
  return { id: created.id, username, display_name: displayName };
}

export async function setServerActive(env, id, active) {
  const rows = await rest(env, `/rest/v1/profiles?id=eq.${id}&role=eq.server_staff&select=id,username`);
  const profile = rows?.[0];
  if (!profile) throw Object.assign(new Error('Server account not found'), { status: 404 });
  await rest(env, `/rest/v1/profiles?id=eq.${id}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { active, updated_at: new Date().toISOString() }
  });
  await authAdmin(env, `/users/${id}`, {
    method: 'PUT',
    body: { ban_duration: active ? 'none' : '876000h' }
  });
  if (!active) await authAdmin(env, `/users/${id}/logout`, { method: 'POST', body: { scope: 'global' } }).catch(() => {});
  await rest(env, '/rest/v1/audit_events', {
    method: 'POST',
    prefer: 'return=minimal',
    body: { action: active ? 'SERVER_ENABLED' : 'SERVER_DISABLED', entity: 'profile', entity_id: id, actor_role: 'admin', metadata: { username: profile.username } }
  });
}

export async function resetServerPassword(env, id, password) {
  if (!validPassword(password)) throw Object.assign(new Error('Password must be at least 8 characters.'), { status: 400 });
  const rows = await rest(env, `/rest/v1/profiles?id=eq.${id}&role=eq.server_staff&select=id`);
  if (!rows?.length) throw Object.assign(new Error('Server account not found'), { status: 404 });
  await authAdmin(env, `/users/${id}`, { method: 'PUT', body: { password } });
  await authAdmin(env, `/users/${id}/logout`, { method: 'POST', body: { scope: 'global' } }).catch(() => {});
  await rest(env, '/rest/v1/audit_events', {
    method: 'POST',
    prefer: 'return=minimal',
    body: { action: 'CREDENTIAL_RESET', entity: 'profile', entity_id: id, actor_role: 'admin', metadata: {} }
  });
}

export async function updateServer(env, id, body) {
  const patch = { updated_at: new Date().toISOString() };
  if (body.display_name) patch.display_name = String(body.display_name).trim();
  if (body.staff_id === null || body.staff_id === '') patch.staff_id = null;
  else if (body.staff_id) patch.staff_id = String(body.staff_id);
  const rows = await rest(env, `/rest/v1/profiles?id=eq.${id}&role=eq.server_staff`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: patch
  });
  return rows?.[0] || null;
}

export async function assertLoginAllowed(env, username) {
  const key = String(username || '').trim().toLowerCase();
  const rows = await rest(env, `/rest/v1/login_attempts?username=eq.${encodeURIComponent(key)}&select=*`);
  const row = rows?.[0];
  if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    throw Object.assign(new Error('Too many attempts. Try again later.'), { status: 429 });
  }
}

export async function recordLoginFailure(env, username) {
  const key = String(username || '').trim().toLowerCase();
  const rows = await rest(env, `/rest/v1/login_attempts?username=eq.${encodeURIComponent(key)}&select=*`);
  const failures = Number(rows?.[0]?.failures || 0) + 1;
  const locked = failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
  await rest(env, '/rest/v1/login_attempts?on_conflict=username', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { username: key, failures, locked_until: locked, updated_at: new Date().toISOString() }
  });
}

export async function clearLoginFailures(env, username) {
  const key = String(username || '').trim().toLowerCase();
  await rest(env, '/rest/v1/login_attempts?on_conflict=username', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { username: key, failures: 0, locked_until: null, updated_at: new Date().toISOString() }
  });
}

export async function findLogin(env, identifier) {
  const value = String(identifier || '').trim().toLowerCase();
  if (!value) return null;
  const username = value.endsWith(`@${SERVER_EMAIL_DOMAIN}`) ? value.split('@')[0] : value;
  if (!value.includes('@') || value.endsWith(`@${SERVER_EMAIL_DOMAIN}`)) {
    const rows = await rest(env, `/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=*`);
    const profile = rows?.[0];
    if (!profile) return null;
    const email = profile.role === 'server_staff' ? serverEmail(profile.username) : (await authAdmin(env, `/users/${profile.id}`)).email;
    return { profile, email };
  }
  const listed = await authAdmin(env, '/users?page=1&per_page=200');
  const user = (listed?.users || []).find((item) => String(item.email || '').toLowerCase() === value);
  if (!user) return null;
  const profile = await profileById(env, user.id);
  return profile ? { profile, email: user.email } : null;
}

async function profileById(env, id) {
  const rows = await rest(env, `/rest/v1/profiles?id=eq.${id}&select=*`);
  return rows?.[0] || null;
}

export async function markLogin(env, profileId) {
  await rest(env, `/rest/v1/profiles?id=eq.${profileId}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { last_login_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  });
}
