-- TEA AMO cloud schema: auth profiles, normalized live orders, and idempotent payments.
-- Historical café records that are not concurrently edited stay in business_documents.

do $$ begin
  create extension if not exists pgcrypto;
exception when others then
  null;
end $$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'server_staff')),
  display_name text not null,
  username text not null unique,
  staff_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  last_seen_at timestamptz
);

create table public.login_attempts (
  username text primary key,
  failures integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalog and floor (servers may read menu and tables; they cannot edit them)
-- ---------------------------------------------------------------------------

create table public.staff (
  id text primary key,
  name text not null,
  role text,
  phone text,
  active boolean not null default true,
  record jsonb not null default '{}'::jsonb
);

create table public.cafe_tables (
  id text primary key,
  name text not null,
  seats integer not null default 1,
  x numeric not null default 0,
  y numeric not null default 0,
  w numeric not null default 10,
  h numeric not null default 10,
  kind text not null default 'regular',
  active boolean not null default true,
  attention boolean not null default false,
  reservation jsonb
);

create table public.menu_items (
  id text primary key,
  name text not null,
  category text not null default 'Menu',
  price numeric not null default 0,
  active boolean not null default true
);

create table public.ingredients (
  key text primary key,
  name text not null,
  unit text,
  stock numeric not null default 0,
  avg_cost numeric not null default 0,
  record jsonb not null default '{}'::jsonb
);

create table public.recipes (
  menu_name text not null,
  ingredient_key text not null references public.ingredients (key) on delete cascade,
  qty numeric not null,
  primary key (menu_name, ingredient_key)
);

-- ---------------------------------------------------------------------------
-- Live orders. Rows, not one JSON document, so two phones cannot silently overwrite each other.
-- ---------------------------------------------------------------------------

create table public.live_orders (
  table_id text primary key references public.cafe_tables (id) on delete cascade,
  version integer not null default 0,
  attention boolean not null default false,
  guest_count integer not null default 1,
  discount_type text not null default 'percent' check (discount_type in ('percent', 'amount')),
  discount_value numeric not null default 0,
  opened_at timestamptz,
  order_ref text,
  order_type text not null default 'Dine-in',
  updated_by uuid references public.profiles (id),
  updated_by_name text,
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id bigint generated always as identity primary key,
  table_id text not null references public.live_orders (table_id) on delete cascade,
  menu_item_id text not null,
  name text not null,
  unit_price numeric not null,
  qty integer not null check (qty > 0),
  served_qty integer not null default 0 check (served_qty >= 0),
  unique (table_id, menu_item_id)
);

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------

create table public.sales (
  id text primary key,
  table_id text,
  business_day text,
  total numeric not null,
  payment text,
  bill jsonb not null,
  result jsonb not null,
  actor_id uuid,
  actor_role text,
  actor_name text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table public.sale_items (
  id bigint generated always as identity primary key,
  sale_id text not null references public.sales (id) on delete cascade,
  menu_item_id text,
  name text not null,
  unit_price numeric not null,
  qty integer not null,
  served_qty integer not null default 0,
  cogs numeric not null default 0
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id text not null unique references public.sales (id) on delete cascade,
  idempotency_key text not null unique,
  method text not null,
  amount numeric not null,
  breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  ingredient_key text,
  qty_delta numeric not null,
  reason text not null,
  ref text,
  note text,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_role text,
  actor_name text,
  action text not null,
  entity text,
  entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table public.business_documents (
  name text primary key,
  revision bigint not null default 1,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index sales_business_day_idx on public.sales (business_day);
create index sales_created_idx on public.sales (created_at desc);
create index audit_events_created_idx on public.audit_events (created_at desc);
create index order_items_table_idx on public.order_items (table_id);

-- ---------------------------------------------------------------------------
-- Auth helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active
  );
$$;

create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and role in ('admin', 'server_staff')
  );
$$;

create or replace function public.business_day_key(ts timestamptz default now())
returns text
language sql
stable
set search_path = public
as $$
  select case
    when extract(hour from (ts at time zone 'Asia/Kathmandu')) < 7
      then to_char((ts at time zone 'Asia/Kathmandu') - interval '1 day', 'YYYY-MM-DD')
    else to_char(ts at time zone 'Asia/Kathmandu', 'YYYY-MM-DD')
  end;
$$;

create or replace function public.touch_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set last_seen_at = now(), updated_at = now()
   where id = auth.uid() and active;
end;
$$;

create or replace function public.write_audit(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  prof public.profiles;
begin
  select * into prof from public.profiles where id = auth.uid();
  insert into public.audit_events (actor_id, actor_role, actor_name, action, entity, entity_id, metadata)
  values (auth.uid(), prof.role, prof.display_name, p_action, p_entity, p_entity_id, p_metadata);
end;
$$;

-- ---------------------------------------------------------------------------
-- Live order mutation. expected_version must match or the write is rejected.
-- ---------------------------------------------------------------------------

create or replace function public.save_table_order(
  p_table_id text,
  p_expected_version integer,
  p_attention boolean,
  p_guest_count integer,
  p_discount_type text,
  p_discount_value numeric,
  p_opened_at timestamptz,
  p_order_ref text,
  p_order_type text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prof public.profiles;
  existing public.live_orders;
  next_version integer;
  item jsonb;
  menu public.menu_items;
  kept_price numeric;
  old_prices jsonb := '{}'::jsonb;
begin
  select * into prof from public.profiles where id = auth.uid();
  if prof.id is null or not prof.active or prof.role not in ('admin', 'server_staff') then
    raise exception 'forbidden';
  end if;
  if p_discount_type not in ('percent', 'amount') then
    raise exception 'invalid_discount';
  end if;

  perform 1 from public.cafe_tables where id = p_table_id and active for update;
  if not found then
    raise exception 'unknown_table';
  end if;

  select * into existing from public.live_orders where table_id = p_table_id for update;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    if existing.table_id is not null and existing.version <> p_expected_version then
      raise exception 'order_version_conflict';
    end if;
    delete from public.live_orders where table_id = p_table_id;
    update public.cafe_tables
       set attention = false
     where id = p_table_id;
    perform public.write_audit('TABLE_CLEARED', 'cafe_table', p_table_id, jsonb_build_object('version', coalesce(existing.version, 0)));
    return jsonb_build_object('ok', true, 'version', 0, 'deleted', true, 'table_id', p_table_id);
  end if;

  if existing.table_id is null then
    if coalesce(p_expected_version, 0) <> 0 then
      raise exception 'order_version_conflict';
    end if;
    next_version := 1;
    insert into public.live_orders (
      table_id, version, attention, guest_count, discount_type, discount_value,
      opened_at, order_ref, order_type, updated_by, updated_by_name, updated_at
    ) values (
      p_table_id, next_version, coalesce(p_attention, false), greatest(1, coalesce(p_guest_count, 1)),
      p_discount_type, greatest(0, coalesce(p_discount_value, 0)),
      coalesce(p_opened_at, now()), p_order_ref, coalesce(p_order_type, 'Dine-in'),
      prof.id, prof.display_name, now()
    );
  else
    if existing.version <> p_expected_version then
      raise exception 'order_version_conflict';
    end if;
    next_version := existing.version + 1;
    update public.live_orders
       set version = next_version,
           attention = coalesce(p_attention, false),
           guest_count = greatest(1, coalesce(p_guest_count, 1)),
           discount_type = p_discount_type,
           discount_value = greatest(0, coalesce(p_discount_value, 0)),
           opened_at = coalesce(p_opened_at, opened_at, now()),
           order_ref = p_order_ref,
           order_type = coalesce(p_order_type, order_type),
           updated_by = prof.id,
           updated_by_name = prof.display_name,
           updated_at = now()
     where table_id = p_table_id;
  end if;

  select coalesce(jsonb_object_agg(menu_item_id, unit_price), '{}'::jsonb)
    into old_prices
    from public.order_items
   where table_id = p_table_id;

  delete from public.order_items where table_id = p_table_id;

  for item in select * from jsonb_array_elements(p_items)
  loop
    if coalesce((item->>'qty')::integer, 0) <= 0 then
      continue;
    end if;
    select * into menu from public.menu_items where id = item->>'menu_item_id' and active;
    if not found then
      raise exception 'unknown_menu_item';
    end if;
    kept_price := nullif(old_prices->>menu.id, '')::numeric;
    insert into public.order_items (table_id, menu_item_id, name, unit_price, qty, served_qty)
    values (
      p_table_id,
      menu.id,
      menu.name,
      coalesce(kept_price, menu.price),
      (item->>'qty')::integer,
      least((item->>'qty')::integer, greatest(0, coalesce((item->>'served_qty')::integer, 0)))
    )
    on conflict (table_id, menu_item_id) do update
      set qty = public.order_items.qty + excluded.qty,
          served_qty = least(public.order_items.qty + excluded.qty, public.order_items.served_qty + excluded.served_qty);
  end loop;

  update public.cafe_tables
     set attention = coalesce(p_attention, false)
   where id = p_table_id;

  perform public.write_audit(
    case when existing.table_id is null then 'TABLE_OPENED' else 'ORDER_UPDATED' end,
    'live_order', p_table_id,
    jsonb_build_object('version', next_version, 'items', jsonb_array_length(p_items))
  );

  return jsonb_build_object('ok', true, 'version', next_version, 'deleted', false, 'table_id', p_table_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Payment. One idempotency key and one locked order produce one sale.
-- ---------------------------------------------------------------------------

create or replace function public.complete_payment(
  p_idempotency_key text,
  p_table_id text,
  p_expected_version integer,
  p_items jsonb,
  p_payment text,
  p_payments jsonb,
  p_cash_received numeric,
  p_change_due numeric,
  p_non_chargeable boolean,
  p_non_chargeable_reason text,
  p_non_chargeable_note text,
  p_customer_id text,
  p_order_type text,
  p_order_ref text,
  p_guest_count integer,
  p_discount_type text,
  p_discount_value numeric,
  p_opened_at timestamptz,
  p_business_day text default null,
  p_time timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prof public.profiles;
  existing_sale public.sales;
  doc jsonb;
  tax_rate numeric := 0;
  day_key text;
  day_row jsonb;
  ord public.live_orders;
  full_subtotal numeric := 0;
  sel_subtotal numeric := 0;
  full_discount numeric := 0;
  sel_discount numeric := 0;
  sel_tax numeric := 0;
  sel_total numeric := 0;
  menu_value numeric := 0;
  bill_id text;
  bill jsonb;
  result jsonb;
  item jsonb;
  line record;
  recipe record;
  used numeric;
  cogs numeric;
  line_cogs numeric;
  total_cogs numeric := 0;
  sale_items jsonb := '[]'::jsonb;
  remaining integer;
  table_name text;
  table_finishes boolean := false;
  now_ts timestamptz := now();
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'idempotency_key_required';
  end if;

  select * into existing_sale from public.sales where idempotency_key = p_idempotency_key;
  if existing_sale.id is not null then
    return existing_sale.result;
  end if;

  select * into prof from public.profiles where id = auth.uid();
  if prof.id is null or not prof.active or prof.role not in ('admin', 'server_staff') then
    raise exception 'forbidden';
  end if;
  if coalesce(p_non_chargeable, false) and prof.role <> 'admin' then
    raise exception 'forbidden';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'empty_payment';
  end if;

  select data into doc from public.business_documents where name = 'master';
  if doc is not null and doc->'business' ? 'taxRate' then
    tax_rate := coalesce((doc->'business'->>'taxRate')::numeric, 0);
  end if;
  if prof.role = 'admin' and p_time is not null then
    now_ts := p_time;
  end if;
  if prof.role = 'admin' and p_business_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    day_key := p_business_day;
  else
    day_key := public.business_day_key(now_ts);
  end if;
  if doc is not null then
    select d into day_row
      from jsonb_array_elements(coalesce(doc->'businessDays', '[]'::jsonb)) d
     where d->>'key' = day_key
     limit 1;
    if day_row is not null and coalesce((day_row->>'finalized')::boolean, false) then
      raise exception 'business_day_finalized';
    end if;
    if day_row is not null and coalesce((day_row->>'posClosed')::boolean, false) then
      raise exception 'pos_closed';
    end if;
  end if;

  if p_table_id is not null then
    select * into ord from public.live_orders where table_id = p_table_id for update;
    if ord.table_id is null then
      raise exception 'order_missing';
    end if;
    if ord.version <> p_expected_version then
      raise exception 'order_version_conflict';
    end if;
    select coalesce(sum(unit_price * qty), 0) into full_subtotal
      from public.order_items where table_id = p_table_id;
    p_discount_type := ord.discount_type;
    p_discount_value := ord.discount_value;
    p_guest_count := ord.guest_count;
    p_opened_at := ord.opened_at;
    select name into table_name from public.cafe_tables where id = p_table_id;
  end if;

  for item in select * from jsonb_array_elements(p_items)
  loop
    if p_table_id is not null then
      select * into line from public.order_items
       where table_id = p_table_id and menu_item_id = item->>'menu_item_id'
       for update;
      if not found or (item->>'qty')::integer <= 0 or (item->>'qty')::integer > line.qty then
        raise exception 'invalid_selection';
      end if;
      sel_subtotal := sel_subtotal + line.unit_price * (item->>'qty')::integer;
    else
      select * into line from public.menu_items where id = item->>'menu_item_id' and active;
      if not found or (item->>'qty')::integer <= 0 then
        raise exception 'invalid_selection';
      end if;
      sel_subtotal := sel_subtotal + line.price * (item->>'qty')::integer;
      full_subtotal := sel_subtotal;
    end if;
  end loop;

  if p_table_id is null then
    full_subtotal := sel_subtotal;
  end if;

  if coalesce(p_discount_type, 'percent') = 'amount' then
    full_discount := least(greatest(coalesce(p_discount_value, 0), 0), full_subtotal);
  else
    full_discount := full_subtotal * least(greatest(coalesce(p_discount_value, 0), 0), 100) / 100;
  end if;
  if full_subtotal = 0 then
    sel_discount := 0;
  else
    sel_discount := full_discount * (sel_subtotal / full_subtotal);
  end if;
  sel_tax := (sel_subtotal - sel_discount) * tax_rate / 100;
  menu_value := sel_subtotal - sel_discount + sel_tax;
  sel_total := case when coalesce(p_non_chargeable, false) then 0 else menu_value end;
  if coalesce(p_non_chargeable, false) then
    p_payments := '{}'::jsonb;
  elsif coalesce(p_payment, 'Cash') <> 'Mixed' then
    p_payments := jsonb_build_object(coalesce(p_payment, 'Cash'), sel_total);
  end if;

  bill_id := 'TA-' || to_char(now_ts at time zone 'Asia/Kathmandu', 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  for item in select * from jsonb_array_elements(p_items)
  loop
    line_cogs := 0;
    if p_table_id is not null then
      select * into line from public.order_items
       where table_id = p_table_id and menu_item_id = item->>'menu_item_id';
    else
      select m.id as menu_item_id, m.name, m.price as unit_price, 0::integer as served_qty
        into line
        from public.menu_items m
       where m.id = item->>'menu_item_id';
    end if;
    for recipe in
      select r.qty, i.key as ingredient_key, i.avg_cost
        from public.recipes r
        join public.ingredients i on i.key = r.ingredient_key
       where r.menu_name = line.name
    loop
      used := recipe.qty * (item->>'qty')::numeric;
      line_cogs := line_cogs + coalesce(recipe.avg_cost, 0) * used;
      update public.ingredients set stock = stock - used where key = recipe.ingredient_key;
      insert into public.inventory_movements (ingredient_key, qty_delta, reason, ref, note)
      values (recipe.ingredient_key, -used, 'sale', bill_id, line.name);
    end loop;
    total_cogs := total_cogs + line_cogs;
    sale_items := sale_items || jsonb_build_array(jsonb_build_object(
      'id', case when line.menu_item_id ~ '^[0-9]+$' then to_jsonb(line.menu_item_id::bigint) else to_jsonb(line.menu_item_id) end,
      'name', line.name,
      'price', line.unit_price,
      'qty', (item->>'qty')::integer,
      'served_qty', least((item->>'qty')::integer, coalesce(line.served_qty, 0)),
      'cogs', line_cogs
    ));
  end loop;

  if p_table_id is null then
    remaining := 0;
    table_finishes := false;
  else
    select coalesce(sum(
      oi.qty - coalesce((
        select (s->>'qty')::integer
          from jsonb_array_elements(p_items) s
         where s->>'menu_item_id' = oi.menu_item_id
      ), 0)
    ), 0) into remaining
      from public.order_items oi
     where oi.table_id = p_table_id;
    table_finishes := remaining <= 0;
  end if;

  bill := jsonb_build_object(
    'id', bill_id,
    'time', now_ts,
    'businessDay', day_key,
    'type', case when p_table_id is not null then 'Dine-in' else coalesce(p_order_type, 'Takeaway') end,
    'ref', case when p_table_id is not null then coalesce(table_name, p_order_ref) else coalesce(p_order_ref, '') end,
    'table_id', p_table_id,
    'guest_count', greatest(1, coalesce(p_guest_count, 1)),
    'payment', case when coalesce(p_non_chargeable, false) then 'Non-Chargeable' else coalesce(p_payment, 'Cash') end,
    'payments', case when coalesce(p_non_chargeable, false) then '{}'::jsonb else coalesce(p_payments, '{}'::jsonb) end,
    'cash_received', case when coalesce(p_non_chargeable, false) then 0 else coalesce(p_cash_received, 0) end,
    'change_due', case when coalesce(p_non_chargeable, false) then 0 else coalesce(p_change_due, 0) end,
    'customer_id', nullif(p_customer_id, '')::bigint,
    'items', sale_items,
    'subtotal', sel_subtotal,
    'discount', sel_discount,
    'tax', sel_tax,
    'total', sel_total,
    'menu_value', menu_value,
    'cogs', total_cogs,
    'non_chargeable', coalesce(p_non_chargeable, false),
    'non_chargeable_reason', coalesce(p_non_chargeable_reason, ''),
    'non_chargeable_note', coalesce(p_non_chargeable_note, ''),
    'dining_session_complete', table_finishes,
    'dining_started_at', case when table_finishes then p_opened_at else null end,
    'dining_ended_at', case when table_finishes then now_ts else null end,
    'dining_minutes', case when table_finishes and p_opened_at is not null then extract(epoch from (now_ts - p_opened_at)) / 60 else null end,
    'source', 'cloud',
    'completed_by', prof.display_name,
    'completed_by_role', prof.role
  );

  if p_table_id is not null then
    for item in select * from jsonb_array_elements(p_items)
    loop
      delete from public.order_items
       where table_id = p_table_id
         and menu_item_id = item->>'menu_item_id'
         and qty <= (item->>'qty')::integer;
      update public.order_items
         set qty = qty - (item->>'qty')::integer,
             served_qty = greatest(0, least(qty - (item->>'qty')::integer, served_qty - least(served_qty, (item->>'qty')::integer)))
       where table_id = p_table_id and menu_item_id = item->>'menu_item_id';
    end loop;
    if table_finishes then
      delete from public.live_orders where table_id = p_table_id;
      update public.cafe_tables set attention = false, reservation = null where id = p_table_id;
    else
      update public.live_orders
         set version = version + 1,
             updated_by = prof.id,
             updated_by_name = prof.display_name,
             updated_at = now()
       where table_id = p_table_id;
      -- A fixed discount was partly used. Leave the remainder on the open order.
      if ord.discount_type = 'amount' then
        update public.live_orders
           set discount_value = greatest(0, discount_value - sel_discount)
         where table_id = p_table_id;
      end if;
    end if;
  end if;

  result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'bill', bill,
    'table_id', p_table_id,
    'table_closed', table_finishes,
    'version', case
      when p_table_id is null or table_finishes then 0
      else (select version from public.live_orders where table_id = p_table_id)
    end
  );

  insert into public.sales (id, table_id, business_day, total, payment, bill, result, actor_id, actor_role, actor_name, idempotency_key)
  values (
    bill_id, p_table_id, day_key, sel_total,
    bill->>'payment', bill, result, prof.id, prof.role, prof.display_name, p_idempotency_key
  );

  insert into public.sale_items (sale_id, menu_item_id, name, unit_price, qty, served_qty, cogs)
  select bill_id, s->>'id', s->>'name', (s->>'price')::numeric, (s->>'qty')::integer, (s->>'served_qty')::integer, (s->>'cogs')::numeric
    from jsonb_array_elements(sale_items) s;

  insert into public.payments (sale_id, idempotency_key, method, amount, breakdown)
  values (bill_id, p_idempotency_key, bill->>'payment', sel_total, coalesce(bill->'payments', '{}'::jsonb));

  perform public.write_audit(
    'PAYMENT_COMPLETED', 'sale', bill_id,
    jsonb_build_object('table_id', p_table_id, 'total', sel_total, 'payment', bill->>'payment', 'idempotency_key', p_idempotency_key)
  );

  return result;
exception
  when unique_violation then
    select * into existing_sale from public.sales where idempotency_key = p_idempotency_key;
    if existing_sale.id is not null then
      return existing_sale.result || jsonb_build_object('replayed', true);
    end if;
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.login_attempts enable row level security;
alter table public.staff enable row level security;
alter table public.cafe_tables enable row level security;
alter table public.menu_items enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.live_orders enable row level security;
alter table public.order_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.audit_events enable row level security;
alter table public.business_documents enable row level security;

create policy profiles_read on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy staff_admin on public.staff
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy tables_read on public.cafe_tables
  for select to authenticated
  using (public.is_active_member());

create policy tables_admin_write on public.cafe_tables
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy menu_read on public.menu_items
  for select to authenticated
  using (public.is_active_member());

create policy menu_admin_write on public.menu_items
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy ingredients_admin on public.ingredients
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy recipes_admin on public.recipes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy orders_read on public.live_orders
  for select to authenticated
  using (public.is_active_member());

create policy order_items_read on public.order_items
  for select to authenticated
  using (public.is_active_member());

create policy sales_admin_read on public.sales
  for select to authenticated
  using (public.is_admin());

create policy sale_items_admin_read on public.sale_items
  for select to authenticated
  using (public.is_admin());

create policy payments_admin_read on public.payments
  for select to authenticated
  using (public.is_admin());

create policy movements_admin on public.inventory_movements
  for select to authenticated
  using (public.is_admin());

create policy audit_admin_read on public.audit_events
  for select to authenticated
  using (public.is_admin());

create policy documents_admin on public.business_documents
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.login_attempts from anon, authenticated;
grant select on public.profiles, public.cafe_tables, public.menu_items, public.live_orders, public.order_items to authenticated;
grant select, insert, update, delete on public.staff, public.ingredients, public.recipes, public.business_documents to authenticated;
grant select on public.sales, public.sale_items, public.payments, public.inventory_movements, public.audit_events to authenticated;

revoke all on function public.save_table_order(text, integer, boolean, integer, text, numeric, timestamptz, text, text, jsonb) from public, anon;
revoke all on function public.complete_payment(text, text, integer, jsonb, text, jsonb, numeric, numeric, boolean, text, text, text, text, text, integer, text, numeric, timestamptz, text, timestamptz) from public, anon;
revoke all on function public.touch_presence() from public, anon;
revoke all on function public.write_audit(text, text, text, jsonb) from public, anon;
grant execute on function public.save_table_order(text, integer, boolean, integer, text, numeric, timestamptz, text, text, jsonb) to authenticated;
grant execute on function public.complete_payment(text, text, integer, jsonb, text, jsonb, numeric, numeric, boolean, text, text, text, text, text, integer, text, numeric, timestamptz, text, timestamptz) to authenticated;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_member() to authenticated;
grant execute on function public.business_day_key(timestamptz) to authenticated;

alter table public.live_orders replica identity full;
alter table public.order_items replica identity full;
alter table public.cafe_tables replica identity full;
alter table public.sales replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.live_orders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.order_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.cafe_tables;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.sales;
  exception when duplicate_object then null;
  end;
end $$;
