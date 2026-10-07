// Local API stand-in for Worker and browser checks when Docker cannot start Supabase.
// It is not the production database and it does not provide Realtime.
import http from 'node:http';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.STUB_PORT || 54399);
const master = JSON.parse(fs.readFileSync(new URL('../master-state.json', import.meta.url), 'utf8'));
const users = [
  { id: 'admin-1', email: 'owner@teaamo.local', password: 'TeaAmoAdmin8', username: 'owner' },
  { id: 'server-1', email: 'sanjay@servers.teaamo.local', password: 'ServerPass8', username: 'sanjay' }
];
const tokens = new Map();
const db = {
  profiles: [
    { id: 'admin-1', role: 'admin', display_name: 'Owner', username: 'owner', staff_id: null, active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_login_at: null, last_seen_at: null },
    { id: 'server-1', role: 'server_staff', display_name: 'Sanjay', username: 'sanjay', staff_id: '1789724801994', active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_login_at: null, last_seen_at: null }
  ],
  login_attempts: [],
  business_documents: [{
    name: 'master',
    revision: 1,
    data: {
      business: {
        name: master.business?.name || 'TEA AMO',
        branch: master.business?.branch || '',
        currency: master.business?.currency || 'Rs',
        taxRate: Number(master.business?.taxRate || 0),
        payment_methods: master.business?.payment_methods || ['Cash'],
        payment_qr: master.business?.payment_qr || {}
      }
    },
    updated_at: new Date().toISOString()
  }],
  live_orders: [],
  order_items: [],
  menu_items: (master.menu || []).filter((item) => item.active !== false).map((item) => ({
    id: String(item.id), name: item.name, category: item.category || 'Menu', price: Number(item.price || 0), active: true
  })),
  cafe_tables: (master.tables || []).map((table) => ({
    id: String(table.id), name: table.name, seats: Number(table.seats || 1), x: Number(table.x || 0), y: Number(table.y || 0),
    w: Number(table.w || 10), h: Number(table.h || 10), kind: table.kind || 'regular', active: table.active !== false,
    attention: !!table.attention, reservation: table.reservation || null
  })),
  ingredients: (master.ingredients || []).map((item) => ({ key: item.key, name: item.name, stock: Number(item.stock || 0), avg_cost: Number(item.avg_cost || 0) })),
  staff: [],
  recipes: [],
  sales: [],
  payments: [],
  audit_events: []
};
const idempotency = new Map();

function send(res, status, data, prefer) {
  if (prefer && prefer.includes('return=minimal')) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(data == null ? '' : JSON.stringify(data));
}

function fail(res, status, message) {
  send(res, status, { message, code: status });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
    });
  });
}

function filters(url) {
  const out = [];
  for (const [key, value] of url.searchParams) out.push([key, value]);
  return out;
}

function matches(row, url) {
  for (const [key, value] of filters(url)) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict'].includes(key)) continue;
    if (value.startsWith('eq.')) {
      const expected = decodeURIComponent(value.slice(3));
      const actual = row[key];
      if (expected === 'true' || expected === 'false') {
        if (String(actual) !== expected && Boolean(actual) !== (expected === 'true')) return false;
      } else if (String(actual ?? '') !== expected) return false;
    } else if (value === 'not.is.null' && row[key] == null) return false;
  }
  return true;
}

function orderRows(rows, url) {
  const spec = url.searchParams.get('order');
  if (!spec) return rows;
  const [field, dir] = spec.split('.');
  return [...rows].sort((a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * (dir === 'desc' ? -1 : 1));
}

function withItems(row) {
  return { ...row, order_items: db.order_items.filter((item) => item.table_id === row.table_id) };
}

function userFrom(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return tokens.get(token) || null;
}

function saveOrder(args) {
  const tableId = args.p_table_id;
  const items = args.p_items || [];
  const current = db.live_orders.find((row) => row.table_id === tableId);
  const expected = Number(args.p_expected_version || 0);
  if (!items.length) {
    if (current && current.version !== expected) {
      const error = new Error('order_version_conflict');
      error.status = 409;
      throw error;
    }
    db.live_orders = db.live_orders.filter((row) => row.table_id !== tableId);
    db.order_items = db.order_items.filter((row) => row.table_id !== tableId);
    return { ok: true, version: 0, deleted: true, table_id: tableId };
  }
  if (!current && expected !== 0) {
    const error = new Error('order_version_conflict');
    error.status = 409;
    throw error;
  }
  if (current && current.version !== expected) {
    const error = new Error('order_version_conflict');
    error.status = 409;
    throw error;
  }
  const version = current ? current.version + 1 : 1;
  const next = {
    table_id: tableId,
    version,
    attention: !!args.p_attention,
    guest_count: args.p_guest_count || 1,
    discount_type: args.p_discount_type || 'percent',
    discount_value: args.p_discount_value || 0,
    opened_at: args.p_opened_at,
    order_ref: args.p_order_ref || '',
    order_type: args.p_order_type || 'Dine-in',
    updated_by_name: 'Sanjay',
    updated_at: new Date().toISOString()
  };
  if (current) Object.assign(current, next);
  else db.live_orders.push(next);
  db.order_items = db.order_items.filter((row) => row.table_id !== tableId);
  for (const item of items) {
    const menu = db.menu_items.find((row) => String(row.id) === String(item.menu_item_id));
    db.order_items.push({
      table_id: tableId,
      menu_item_id: String(item.menu_item_id),
      name: menu?.name || 'Item',
      unit_price: Number(menu?.price || 0),
      qty: Number(item.qty || 0),
      served_qty: Number(item.served_qty || 0)
    });
  }
  return { ok: true, version, deleted: false, table_id: tableId };
}

function completePayment(args) {
  const key = String(args.p_idempotency_key || '');
  if (key && idempotency.has(key)) return { ...idempotency.get(key), replayed: true };
  const tableId = args.p_table_id;
  const current = tableId ? db.live_orders.find((row) => row.table_id === tableId) : null;
  if (tableId && !current) {
    const error = new Error('order_missing');
    error.status = 409;
    throw error;
  }
  if (current && current.version !== Number(args.p_expected_version || 0)) {
    const error = new Error('order_version_conflict');
    error.status = 409;
    throw error;
  }
  const items = args.p_items || [];
  if (!items.length) {
    const error = new Error('empty_payment');
    error.status = 400;
    throw error;
  }
  let total = 0;
  const billItems = items.map((item) => {
    const menu = db.menu_items.find((row) => String(row.id) === String(item.menu_item_id));
    const price = Number(menu?.price || 0);
    total += price * Number(item.qty || 0);
    return { id: item.menu_item_id, name: menu?.name || 'Item', qty: Number(item.qty || 0), price };
  });
  const bill = { id: `TA-STUB-${idempotency.size + 1}`, time: new Date().toISOString(), payment: args.p_payment || 'Cash', total, items: billItems };
  const result = { ok: true, bill, table_closed: true, replayed: false };
  if (key) idempotency.set(key, result);
  db.sales.push({ id: bill.id, bill, created_at: bill.time });
  db.payments.push({ id: bill.id, sale_id: bill.id });
  if (tableId) {
    db.live_orders = db.live_orders.filter((row) => row.table_id !== tableId);
    db.order_items = db.order_items.filter((row) => row.table_id !== tableId);
  }
  return result;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const body = await readBody(req);
    const prefer = req.headers.prefer || '';
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      const user = users.find((item) => item.email === body.email && item.password === body.password);
      if (!user) return fail(res, 400, 'invalid');
      const access = randomUUID();
      const refresh = randomUUID();
      tokens.set(access, user);
      tokens.set(refresh, user);
      return send(res, 200, { access_token: access, refresh_token: refresh, user: { id: user.id, email: user.email } });
    }
    if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
      const user = userFrom(req);
      if (!user) return fail(res, 401, 'invalid');
      return send(res, 200, { id: user.id, email: user.email });
    }
    if (url.pathname === '/auth/v1/admin/users' && req.method === 'POST') {
      const id = randomUUID();
      const user = { id, email: body.email, password: body.password, username: body.user_metadata?.username };
      users.push(user);
      return send(res, 200, { id, email: user.email });
    }
    if (url.pathname === '/auth/v1/admin/users' && req.method === 'GET') {
      return send(res, 200, { users: users.map((user) => ({ id: user.id, email: user.email })) });
    }
    const adminUser = url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)(?:\/(logout))?$/);
    if (adminUser && req.method === 'GET') {
      const user = users.find((item) => item.id === adminUser[1]);
      return send(res, user ? 200 : 404, user ? { id: user.id, email: user.email } : { message: 'missing' });
    }
    if (adminUser && (req.method === 'PUT' || req.method === 'POST' || req.method === 'DELETE')) {
      if (req.method === 'PUT' && body?.password) {
        const user = users.find((item) => item.id === adminUser[1]);
        if (user) user.password = body.password;
      }
      if (req.method === 'DELETE') {
        const index = users.findIndex((item) => item.id === adminUser[1]);
        if (index >= 0) users.splice(index, 1);
      }
      return send(res, 200, {});
    }
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
    if (rpc && req.method === 'POST') {
      try {
        if (rpc[1] === 'save_table_order') return send(res, 200, saveOrder(body || {}));
        if (rpc[1] === 'complete_payment') return send(res, 200, completePayment(body || {}));
        if (rpc[1] === 'touch_presence') {
          const user = userFrom(req);
          const profile = db.profiles.find((item) => item.id === user?.id);
          if (profile) profile.last_seen_at = new Date().toISOString();
          return send(res, 200, { ok: true });
        }
        return fail(res, 404, 'unknown rpc');
      } catch (error) {
        return fail(res, error.status || 500, error.message);
      }
    }
    const tableMatch = url.pathname.match(/^\/rest\/v1\/([^/]+)$/);
    if (!tableMatch) return fail(res, 404, 'unknown');
    const name = tableMatch[1];
    const table = db[name];
    if (!table) return fail(res, 404, 'unknown table');
    if (req.method === 'GET') {
      let rows = orderRows(table.filter((row) => matches(row, url)), url);
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = url.searchParams.get('limit');
      if (limit) rows = rows.slice(offset, offset + Number(limit));
      if (name === 'live_orders') rows = rows.map(withItems);
      return send(res, 200, rows);
    }
    if (req.method === 'POST') {
      const incoming = Array.isArray(body) ? body : [body];
      const conflict = url.searchParams.get('on_conflict');
      const stored = [];
      for (const row of incoming) {
        if (!row) continue;
        if (conflict) {
          const keys = conflict.split(',');
          const index = table.findIndex((item) => keys.every((key) => String(item[key]) === String(row[key])));
          if (index >= 0) table[index] = { ...table[index], ...row };
          else table.push(row);
          stored.push(index >= 0 ? table[index] : row);
        } else {
          table.push(row);
          stored.push(row);
        }
      }
      return send(res, 201, prefer.includes('return=representation') ? stored : null, prefer);
    }
    if (req.method === 'PATCH') {
      const updated = [];
      for (const row of table) {
        if (!matches(row, url)) continue;
        Object.assign(row, body || {});
        updated.push(row);
      }
      return send(res, 200, prefer.includes('return=representation') ? updated : null, prefer);
    }
    if (req.method === 'DELETE') {
      const keep = table.filter((row) => !matches(row, url));
      table.splice(0, table.length, ...keep);
      return send(res, 200, null, 'return=minimal');
    }
    return fail(res, 405, 'method');
  } catch (error) {
    send(res, 500, { message: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`stub supabase http://127.0.0.1:${port}`);
  console.log('owner / TeaAmoAdmin8');
  console.log('sanjay / ServerPass8');
});
