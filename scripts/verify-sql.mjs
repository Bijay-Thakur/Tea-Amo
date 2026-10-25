import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const raw = fs.readFileSync(new URL('../supabase/migrations/20261007120000_tea_amo_cloud.sql', import.meta.url), 'utf8');
const publication = raw.indexOf('alter publication supabase_realtime');
const sql = publication === -1 ? raw : raw.slice(0, raw.lastIndexOf('do $$', publication));

const db = new PGlite();
const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
}

await db.exec(`
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;
`);
await db.exec(sql);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261007133000_table_seated.sql', import.meta.url), 'utf8'));
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261014090000_close_paid_table_atomically.sql', import.meta.url), 'utf8'));
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261007170000_menu_images.sql', import.meta.url), 'utf8').replace(/do \$\$[\s\S]+end \$\$;/g, ''));
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261024010000_ops_reset_and_storefront.sql', import.meta.url), 'utf8'));
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261024140000_fast_checkout_config.sql', import.meta.url), 'utf8'));
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261025030000_production_integrity.sql', import.meta.url), 'utf8'));
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261025052142_lock_guest_order_quote.sql', import.meta.url), 'utf8'));

const admin = '11111111-1111-4111-8111-111111111111';
const serverA = '22222222-2222-4222-8222-222222222222';
const serverB = '33333333-3333-4333-8333-333333333333';
await db.exec(`
  insert into auth.users (id) values ('${admin}'), ('${serverA}'), ('${serverB}');
  insert into public.profiles (id, role, display_name, username, active) values
    ('${admin}', 'admin', 'Owner', 'owner', true),
    ('${serverA}', 'server_staff', 'Server Test A', 'servertesta', true),
    ('${serverB}', 'server_staff', 'Server Test B', 'servertestb', true);
  insert into public.cafe_tables (id, name, seats, x, y, w, h) values ('t6', 'T6', 4, 52, 45, 10, 13);
  insert into public.menu_items (id, name, price, active) values ('1', 'Chicken Momo', 180, true), ('2', 'Milk Tea', 80, true);
  insert into public.ingredients (key, name, unit, stock, avg_cost) values ('momo-dough', 'Dough', 'g', 1000, 0.2);
  insert into public.recipes (menu_name, ingredient_key, qty) values ('Chicken Momo', 'momo-dough', 50);
  insert into public.business_documents (name, revision, data) values ('master', 1, '{"business":{"taxRate":0},"businessDays":[]}'::jsonb);
`);

async function asUser(id, statement) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [id]);
    return tx.query(statement);
  });
}

const opened = await asUser(serverA, `select public.save_table_order('t6', 0, false, 2, 'percent', 0, now(), 'T6', 'Dine-in', '[{"menu_item_id":"1","qty":1,"served_qty":0},{"menu_item_id":"2","qty":1,"served_qty":0}]'::jsonb) as result`);
check('open T6', opened.rows[0].result.version === 1, JSON.stringify(opened.rows[0].result));

let conflict = false;
try {
  await asUser(serverB, `select public.save_table_order('t6', 0, false, 2, 'percent', 0, now(), 'T6', 'Dine-in', '[{"menu_item_id":"1","qty":9,"served_qty":0}]'::jsonb)`);
} catch (error) {
  conflict = String(error.message).includes('order_version_conflict');
}
check('stale order version is rejected', conflict);

const served = await asUser(serverB, `select public.save_table_order('t6', 1, false, 2, 'percent', 0, now(), 'T6', 'Dine-in', '[{"menu_item_id":"1","qty":1,"served_qty":1},{"menu_item_id":"2","qty":1,"served_qty":0}]'::jsonb) as result`);
check('served update lands', served.rows[0].result.version === 2);
check('served quantity persists', Number((await db.query(`select served_qty from public.order_items where table_id = 't6' and menu_item_id = '1'`)).rows[0].served_qty) === 1);
await db.query(`update public.cafe_tables set seated = true where id = 't6'`);

const pay = (key) => `select public.complete_payment('${key}', 't6', 2, '[{"menu_item_id":"1","qty":1},{"menu_item_id":"2","qty":1}]'::jsonb, 'Cash', '{}'::jsonb, 0, 0, false, '', '', null, 'Dine-in', 'T6', 2, 'percent', 0, now(), null, null) as result`;
const keyA = 'pay-key-server-a-001';
const keyB = 'pay-key-server-b-001';
let first;
try {
  first = await asUser(serverA, pay(keyA));
} catch (error) {
  console.error('PAYMENT ERROR', error.message);
  console.error(String(error.detail || ''));
  console.error(String(error.where || '').slice(0, 800));
  process.exit(1);
}
let secondError = '';
try { await asUser(serverB, pay(keyB)); } catch (error) { secondError = String(error.message); }
check('second payment is rejected', /order_missing|order_version_conflict/.test(secondError), secondError);

const sales = await db.query('select id, total from public.sales');
const payments = await db.query('select id from public.payments');
const stock = await db.query(`select stock from public.ingredients where key = 'momo-dough'`);
const open = await db.query(`select table_id from public.live_orders where table_id = 't6'`);
check('exactly one sale', sales.rows.length === 1, `sales ${sales.rows.length}`);
check('exactly one payment', payments.rows.length === 1, `payments ${payments.rows.length}`);
check('inventory deducted once', Number(stock.rows[0].stock) === 950, `stock ${stock.rows[0].stock}`);
check('table released', open.rows.length === 0);
check('paid table seat released in payment transaction', (await db.query(`select seated from public.cafe_tables where id = 't6'`)).rows[0].seated === false);

const replay = await asUser(serverA, pay(keyA));
const salesAfter = await db.query('select id from public.sales');
check('replay does not create another sale', salesAfter.rows.length === 1 && replay.rows[0].result.bill.id === first.rows[0].result.bill.id && replay.rows[0].result.replayed === true);

const blob = 'q'.repeat(2_200_000);
const fat = await db.query(`update public.business_documents set data = jsonb_set(jsonb_set(data, '{business,taxRate}', '13'::jsonb), '{business,payment_qr}', to_jsonb($1::text)) where name = 'master' returning octet_length(data::text) as bytes`, [blob]);
async function elapsed(statement) {
  const start = performance.now();
  await db.query(statement);
  return performance.now() - start;
}
const fullReadMs = await elapsed(`select data#>>'{business,taxRate}' as tax from public.business_documents where name = 'master'`);
const slimReadMs = await elapsed(`select tax_rate from public.cafe_checkout_config where name = 'master'`);
const configBytes = Number((await db.query(`select octet_length(tax_rate::text) + octet_length(business_days::text) as n from public.cafe_checkout_config where name = 'master'`)).rows[0].n);
console.log(`checkout read: full document ${fullReadMs.toFixed(1)} ms, config row ${slimReadMs.toFixed(1)} ms, document bytes ${fat.rows[0].bytes}, config bytes ${configBytes}`);
check('checkout config stays small beside the large document', configBytes < 10000 && Number(fat.rows[0].bytes) > 2000000, `config ${configBytes} bytes, document ${fat.rows[0].bytes} bytes`);
check('tax rate is projected beside the large document', Number((await db.query(`select tax_rate from public.cafe_checkout_config where name = 'master'`)).rows[0].tax_rate) === 13);

await asUser(serverA, `select public.save_table_order('t6', 0, false, 1, 'percent', 0, now(), 'T6', 'Dine-in', '[{"menu_item_id":"2","qty":2,"served_qty":0}]'::jsonb)`);
const taxedStarted = performance.now();
const taxed = await asUser(serverA, `select public.complete_payment('pay-key-tax-001', 't6', 1, '[{"menu_item_id":"2","qty":2}]'::jsonb, 'Cash', '{}'::jsonb, 200, 19.2, false, '', '', null, 'Dine-in', 'T6', 1, 'percent', 0, now(), null, null) as result`);
console.log(`complete_payment beside a large master document ${(performance.now() - taxedStarted).toFixed(1)} ms`);
check('tax follows the projected rate', Math.abs(Number(taxed.rows[0].result.bill.tax) - 20.8) < 0.001, String(taxed.rows[0].result.bill.tax));
check('taxed total is subtotal plus tax', Math.abs(Number(taxed.rows[0].result.bill.total) - 180.8) < 0.001, String(taxed.rows[0].result.bill.total));
const taxedReplay = await asUser(serverA, `select public.complete_payment('pay-key-tax-001', 't6', 1, '[{"menu_item_id":"2","qty":2}]'::jsonb, 'Cash', '{}'::jsonb, 200, 19.2, false, '', '', null, 'Dine-in', 'T6', 1, 'percent', 0, now(), null, null) as result`);
check('repeated payment key does not create another sale', taxedReplay.rows[0].result.replayed === true && Number((await db.query('select count(*)::int as n from public.sales')).rows[0].n) === 2);

await asUser(serverA, `select public.save_table_order('t6', 0, false, 1, 'percent', 0, now(), 'T6', 'Dine-in', '[{"menu_item_id":"2","qty":1,"served_qty":0}]'::jsonb)`);
const dayKey = (await db.query(`select public.business_day_key(now()) as day`)).rows[0].day;
await db.query(`update public.business_documents set data = jsonb_set(data, '{businessDays}', $1::jsonb) where name = 'master'`, [JSON.stringify([{ key: dayKey, finalized: true, posClosed: false }])]);
let closedDay = false;
try {
  await asUser(serverA, `select public.complete_payment('pay-key-closed-001', 't6', 1, '[{"menu_item_id":"2","qty":1}]'::jsonb, 'eSewa', '{}'::jsonb, 0, 0, false, '', '', null, 'Dine-in', 'T6', 1, 'percent', 0, now(), null, null)`);
} catch (error) {
  closedDay = String(error.message).includes('business_day_finalized');
}
check('finalized business day is rejected from checkout config', closedDay);
check('rejected checkout writes no sale', Number((await db.query('select count(*)::int as n from public.sales')).rows[0].n) === 2);
check('rejected checkout does not deduct inventory', Number((await db.query(`select stock from public.ingredients where key = 'momo-dough'`)).rows[0].stock) === 950);

await db.query(`update public.profiles set active = false where id = '${serverA}'`);
let blocked = false;
try {
  await asUser(serverA, `select public.save_table_order('t6', 0, false, 1, 'percent', 0, now(), 'T6', 'Dine-in', '[{"menu_item_id":"2","qty":1,"served_qty":0}]'::jsonb)`);
} catch (error) {
  blocked = String(error.message).includes('forbidden');
}
check('disabled server is rejected', blocked);

await db.query(`insert into public.sales (id, total, bill, result, idempotency_key) values ('S1', 100, '{"id":"S1"}'::jsonb, '{}'::jsonb, 'sale-1')`);
const preview = await db.query(`select public.reset_operational_preview() as result`);
check('reset preview sees sales', Number(preview.rows[0].result.sales) >= 1, JSON.stringify(preview.rows[0].result));
const wiped = await db.query(`select public.reset_operational_data('{"business":{"name":"TEA AMO"},"menu":[],"bills":[]}'::jsonb, 1, '${admin}', 'Owner') as result`);
check('reset reports verified', wiped.rows[0].result.verified === true, JSON.stringify(wiped.rows[0].result));
check('sales gone after reset', Number((await db.query('select count(*) as n from public.sales')).rows[0].n) === 0);
check('generation advanced', Number((await db.query(`select operational_generation from public.business_documents where name = 'master'`)).rows[0].operational_generation) === 2);

const guest = await db.query(`select public.place_guest_order('idem-guest-1', 'pickup', 'pay_at_pickup', 'Bijay', '9800000000', '', '', '', '[{"menu_item_id":"1","name":"Chicken Momo","unit_price":180,"qty":1}]'::jsonb, 180, 0, 0, 180, 'Rs', 2) as result`);
check('guest order created once', Boolean(guest.rows[0].result.public_ref));
const guestReplay = await db.query(`select public.place_guest_order('idem-guest-1', 'pickup', 'pay_at_pickup', 'Bijay', '9800000000', '', '', '', '[{"menu_item_id":"1","name":"Chicken Momo","unit_price":180,"qty":1}]'::jsonb, 180, 0, 0, 180, 'Rs', 2) as result`);
check('guest idempotency', guest.rows[0].result.id === guestReplay.rows[0].result.id);
const slim = await db.query(`select public.workspace_business_config() as result`);
check('workspace config omits payment_qr', slim.rows[0].result.payment_qr == null && slim.rows[0].result.name === 'TEA AMO');

await db.query(`update public.menu_items set price = 250 where id = '1'`);
const quotedGuest = await db.query(`select public.place_guest_order('idem-guest-quote', 'delivery', 'cash_on_delivery', 'Mina', '9800000000', 'Thamel street', '', '', '[{"menu_item_id":"1","name":"Chicken Momo","unit_price":180,"qty":2}]'::jsonb, 360, 0, 80, 440, 'Rs', 2) as result`);
const quotedId = quotedGuest.rows[0].result.id;
let quoteLocked = false;
try {
  await db.query(`update public.guest_orders set total = 1, subtotal = 1 where id = '${quotedId}'`);
} catch (error) {
  quoteLocked = String(error.message).includes('guest_quote_locked');
}
check('guest quote cannot be rewritten', quoteLocked);
let staffQuoteDenied = false;
try {
  await db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [serverA]);
    await tx.exec('set local role authenticated');
    await tx.query(`update public.guest_orders set total = 1 where id = '${quotedId}'`);
  });
} catch (error) {
  staffQuoteDenied = /permission denied/i.test(String(error.message));
}
check('staff session cannot change the guest total', staffQuoteDenied);
const quotedPay = await asUser(admin, `select public.complete_guest_payment('${quotedId}'::uuid, 'Cash', '{}'::jsonb, 440, 0) as result`);
const quoteCharged = Number(quotedPay.rows[0].result.bill.total);
check('guest payment charges the stored quote', Math.abs(quoteCharged - 440) < 0.001 && Number(quotedPay.rows[0].result.bill.items[0].price) === 180 && Number(quotedPay.rows[0].result.bill.delivery_fee) === 80, JSON.stringify(quotedPay.rows[0].result.bill));
const guestSales = Number((await db.query('select count(*)::int as n from public.sales')).rows[0].n);
const stockAfterGuestPay = Number((await db.query(`select stock from public.ingredients where key = 'momo-dough'`)).rows[0].stock);
check('guest payment deducts the recipe once', stockAfterGuestPay === -100, String(stockAfterGuestPay));
const quotedReplay = await asUser(admin, `select public.complete_guest_payment('${quotedId}'::uuid, 'Cash', '{}'::jsonb, 440, 0) as result`);
const guestPaid = await db.query(`select payment_status, sale_id, status from public.guest_orders where id = '${quotedId}'`);
const salesAfterReplay = Number((await db.query('select count(*)::int as n from public.sales')).rows[0].n);
check('second guest payment replays the same sale', quotedReplay.rows[0].result.replayed === true && salesAfterReplay === guestSales && guestPaid.rows[0].payment_status === 'paid' && guestPaid.rows[0].status === 'completed' && guestPaid.rows[0].sale_id);

const stockBeforeRace = Number((await db.query(`select stock from public.ingredients where key = 'momo-dough'`)).rows[0].stock);
const salesBeforeRace = Number((await db.query('select count(*)::int as n from public.sales')).rows[0].n);
await db.exec(`
  create or replace function public.debug_reset_race() returns trigger language plpgsql as $fn$
  begin
    insert into public.guest_orders (public_ref, access_token, fulfillment, payment_method, customer_name, customer_phone, items, subtotal, total, idempotency_key)
    values ('TA-RACE', 'token-race-reset', 'pickup', 'pay_at_pickup', 'Race', '9800000001', '[]'::jsonb, 0, 0, 'idem-race-reset');
    return null;
  end $fn$;
`);
await db.exec(`create trigger debug_reset_race after update on public.ingredients for each statement execute function public.debug_reset_race()`);
let resetRolledBack = false;
try {
  await asUser(admin, `select public.reset_operational_data('{"business":{"name":"TEA AMO"},"menu":[],"bills":[]}'::jsonb, null, '${admin}', 'Owner')`);
} catch (error) {
  resetRolledBack = String(error.message).includes('reset_not_verified');
}
await db.exec(`drop trigger if exists debug_reset_race on public.ingredients`);
const salesAfterRace = Number((await db.query('select count(*)::int as n from public.sales')).rows[0].n);
const stockAfterRace = Number((await db.query(`select stock from public.ingredients where key = 'momo-dough'`)).rows[0].stock);
check('failed reset rolls back', resetRolledBack && salesAfterRace === salesBeforeRace && stockAfterRace === stockBeforeRace);

const replaced = await db.query(`select public.replace_recipes('[{"menu_name":"Chicken Momo","ingredient_key":"momo-dough","qty":50}]'::jsonb) as n`);
const recipeRows = Number((await db.query(`select count(*)::int as n from public.recipes`)).rows[0].n);
check('recipes replace in one transaction', Number(replaced.rows[0].n) === 1 && recipeRows === 1);

if (failures.length) {
  console.error('Failed: ' + failures.join(', '));
  process.exit(1);
}
console.log('SQL checks passed.');
