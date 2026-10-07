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

const replay = await asUser(serverA, pay(keyA));
const salesAfter = await db.query('select id from public.sales');
check('replay does not create another sale', salesAfter.rows.length === 1 && replay.rows[0].result.bill.id === first.rows[0].result.bill.id);

await db.query(`update public.profiles set active = false where id = '${serverA}'`);
let blocked = false;
try {
  await asUser(serverA, `select public.save_table_order('t6', 0, false, 1, 'percent', 0, now(), 'T6', 'Dine-in', '[{"menu_item_id":"2","qty":1,"served_qty":0}]'::jsonb)`);
} catch (error) {
  blocked = String(error.message).includes('forbidden');
}
check('disabled server is rejected', blocked);

if (failures.length) {
  console.error('Failed: ' + failures.join(', '));
  process.exit(1);
}
console.log('SQL checks passed.');
