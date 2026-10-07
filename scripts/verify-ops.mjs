import { call, requireConfig, signIn, serviceKey } from './supabase-admin.mjs';

requireConfig();
const adminEmail = process.env.TEA_AMO_ADMIN_EMAIL || `${(process.env.TEA_AMO_ADMIN_USERNAME || 'owner')}@teaamo.local`;
const adminPassword = process.env.TEA_AMO_ADMIN_PASSWORD;
if (!adminPassword) {
  console.error('Set TEA_AMO_ADMIN_PASSWORD.');
  process.exit(1);
}

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
}

async function userCall(token, path, options = {}) {
  return call(path, { ...options, key: token });
}

const password = 'Server-test-pass-1';
const accounts = [
  { username: 'servertesta', name: 'Server Test A' },
  { username: 'servertestb', name: 'Server Test B' }
];
const created = [];

async function removeAccount(id) {
  if (!id) return;
  await call(`/auth/v1/admin/users/${id}`, { method: 'DELETE' }).catch(() => {});
  await call(`/rest/v1/profiles?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
}

try {
  for (const account of accounts) {
    const existing = await call(`/rest/v1/profiles?username=eq.${account.username}&select=id`);
    if (existing?.[0]) await removeAccount(existing[0].id);
    const user = await call('/auth/v1/admin/users', {
      method: 'POST',
      body: { email: `${account.username}@servers.teaamo.local`, password, email_confirm: true }
    });
    await call('/rest/v1/profiles', {
      method: 'POST',
      body: { id: user.id, role: 'server_staff', display_name: account.name, username: account.username, active: true }
    });
    created.push(user.id);
  }

  const admin = await signIn(adminEmail, adminPassword);
  const serverA = await signIn('servertesta@servers.teaamo.local', password);
  const serverB = await signIn('servertestb@servers.teaamo.local', password);
  check('admin login', admin.user?.id && admin.access_token);
  check('server login', !!serverA.access_token && !!serverB.access_token);

  const adminProfile = await userCall(admin.access_token, '/rest/v1/profiles?select=role&id=eq.' + admin.user.id);
  check('admin role is database role', adminProfile?.[0]?.role === 'admin');

  const menu = await userCall(serverA.access_token, '/rest/v1/menu_items?active=eq.true&select=id,name,price&limit=2');
  const table = await userCall(serverA.access_token, '/rest/v1/cafe_tables?id=eq.t6&select=id,name');
  check('server can read menu and T6', menu.length >= 1 && table.length === 1, `menu ${menu.length}, tables ${table.length}`);
  if (menu.length < 1 || !table.length) throw new Error('Migrate master-state before verify so menu and T6 exist.');

  await call('/rest/v1/order_items?table_id=eq.t6', { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
  await call('/rest/v1/live_orders?table_id=eq.t6', { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});

  const open = await userCall(serverA.access_token, '/rest/v1/rpc/save_table_order', {
    method: 'POST',
    body: {
      p_table_id: 't6', p_expected_version: 0, p_attention: false, p_guest_count: 2,
      p_discount_type: 'percent', p_discount_value: 0, p_opened_at: new Date().toISOString(),
      p_order_ref: 'T6', p_order_type: 'Dine-in',
      p_items: menu.slice(0, 2).map((item) => ({ menu_item_id: String(item.id), qty: 1, served_qty: 0 }))
    }
  });
  check('server A opens T6', open.version === 1, JSON.stringify(open));

  const seen = await userCall(serverB.access_token, '/rest/v1/order_items?table_id=eq.t6&select=menu_item_id,qty');
  check('server B sees the items', seen.length === Math.min(2, menu.length), `rows ${seen.length}`);

  let conflict = false;
  try {
    await userCall(serverB.access_token, '/rest/v1/rpc/save_table_order', {
      method: 'POST',
      body: {
        p_table_id: 't6', p_expected_version: 0, p_attention: false, p_guest_count: 2,
        p_discount_type: 'percent', p_discount_value: 0, p_opened_at: new Date().toISOString(),
        p_order_ref: 'T6', p_order_type: 'Dine-in',
        p_items: [{ menu_item_id: String(menu[0].id), qty: 9, served_qty: 0 }]
      }
    });
  } catch (error) {
    conflict = String(error.message).includes('order_version_conflict');
  }
  check('stale version is rejected', conflict);

  const served = await userCall(serverB.access_token, '/rest/v1/rpc/save_table_order', {
    method: 'POST',
    body: {
      p_table_id: 't6', p_expected_version: 1, p_attention: false, p_guest_count: 2,
      p_discount_type: 'percent', p_discount_value: 0, p_opened_at: new Date().toISOString(),
      p_order_ref: 'T6', p_order_type: 'Dine-in',
      p_items: menu.slice(0, seen.length).map((item, index) => ({ menu_item_id: String(item.id), qty: 1, served_qty: index === 0 ? 1 : 0 }))
    }
  });
  check('server B marks one item served', served.version === 2);

  const before = await call('/rest/v1/sales?select=id');
  const pay = (key, token) => userCall(token, '/rest/v1/rpc/complete_payment', {
    method: 'POST',
    body: {
      p_idempotency_key: key, p_table_id: 't6', p_expected_version: 2,
      p_items: menu.slice(0, seen.length).map((item) => ({ menu_item_id: String(item.id), qty: 1 })),
      p_payment: 'Cash', p_payments: {}, p_cash_received: 0, p_change_due: 0,
      p_non_chargeable: false, p_non_chargeable_reason: '', p_non_chargeable_note: '',
      p_customer_id: null, p_order_type: 'Dine-in', p_order_ref: 'T6', p_guest_count: 2,
      p_discount_type: 'percent', p_discount_value: 0, p_opened_at: new Date().toISOString(),
      p_business_day: null, p_time: null
    }
  });
  const firstKey = crypto.randomUUID();
  const secondKey = crypto.randomUUID();
  const raced = await Promise.allSettled([pay(firstKey, serverA.access_token), pay(secondKey, serverB.access_token)]);
  const won = raced.filter((item) => item.status === 'fulfilled');
  check('exactly one simultaneous payment succeeds', won.length === 1, raced.map((item) => item.status === 'fulfilled' ? 'ok' : item.reason?.message).join(' | '));
  const winningKey = raced[0].status === 'fulfilled' ? firstKey : secondKey;
  const replay = won.length === 1 ? await pay(winningKey, serverA.access_token) : null;
  check('same idempotency key does not create a second sale', !!replay && replay.bill?.id === won[0]?.value?.bill?.id);
  const after = await call('/rest/v1/sales?select=id');
  check('one new sale row', after.length === before.length + 1, `${before.length} -> ${after.length}`);
  const stillOpen = await call('/rest/v1/live_orders?table_id=eq.t6&select=table_id');
  check('T6 is available after payment', stillOpen.length === 0);

  const priceBefore = menu[0].price;
  const patched = await userCall(serverA.access_token, `/rest/v1/menu_items?id=eq.${encodeURIComponent(menu[0].id)}`, {
    method: 'PATCH', prefer: 'return=representation', body: { price: Number(priceBefore) + 50 }
  }).catch((error) => error);
  const priceAfter = await call(`/rest/v1/menu_items?id=eq.${encodeURIComponent(menu[0].id)}&select=price`);
  check('server cannot change a menu price', Number(priceAfter[0].price) === Number(priceBefore), `before ${priceBefore} after ${priceAfter[0].price}`);

  let createdProfile = false;
  try {
    await userCall(serverA.access_token, '/rest/v1/profiles', {
      method: 'POST',
      body: { id: crypto.randomUUID(), role: 'server_staff', display_name: 'Nope', username: 'nope' + Date.now(), active: true }
    });
    createdProfile = true;
  } catch { createdProfile = false; }
  check('server cannot create an account profile', !createdProfile);

  await call(`/rest/v1/profiles?id=eq.${created[0]}`, { method: 'PATCH', prefer: 'return=minimal', body: { active: false } });
  let blocked = false;
  try {
    await userCall(serverA.access_token, '/rest/v1/rpc/save_table_order', {
      method: 'POST',
      body: {
        p_table_id: 't6', p_expected_version: 0, p_attention: false, p_guest_count: 1,
        p_discount_type: 'percent', p_discount_value: 0, p_opened_at: null, p_order_ref: 'T6', p_order_type: 'Dine-in',
        p_items: [{ menu_item_id: String(menu[0].id), qty: 1, served_qty: 0 }]
      }
    });
  } catch (error) {
    blocked = String(error.message).includes('forbidden');
  }
  check('disabled server cannot edit orders', blocked);
  await call(`/rest/v1/profiles?id=eq.${created[0]}`, { method: 'PATCH', prefer: 'return=minimal', body: { active: true } });
  const again = await userCall(serverA.access_token, '/rest/v1/menu_items?select=id&limit=1');
  check('re-enabled server can read the menu', again.length === 1);
  void patched;
  void serviceKey;
} finally {
  for (const id of created) await removeAccount(id);
  await call('/rest/v1/order_items?table_id=eq.t6', { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
  await call('/rest/v1/live_orders?table_id=eq.t6', { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
}

if (failures.length) {
  console.error('Failed: ' + failures.join(', '));
  process.exit(1);
}
console.log('Operational checks passed.');
