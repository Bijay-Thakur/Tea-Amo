-- Checkout reads tax rate and business-day flags from a small row.
-- The master document also stores payment QR images, so loading it on every sale was the slow part.

create table public.cafe_checkout_config (
  name text primary key,
  tax_rate numeric not null default 0,
  business_days jsonb not null default '[]'::jsonb
);

create or replace function public.sync_cafe_checkout_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_days jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(new.data->'businessDays') = 'array' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', d->>'key',
      'finalized', coalesce((d->>'finalized')::boolean, false),
      'posClosed', coalesce((d->>'posClosed')::boolean, false)
    )), '[]'::jsonb)
      into next_days
      from jsonb_array_elements(new.data->'businessDays') d;
  end if;
  insert into public.cafe_checkout_config (name, tax_rate, business_days)
  values (
    new.name,
    coalesce(nullif(new.data#>>'{business,taxRate}', '')::numeric, 0),
    next_days
  )
  on conflict (name) do update
    set tax_rate = excluded.tax_rate,
        business_days = excluded.business_days;
  return new;
end;
$$;

drop trigger if exists sync_cafe_checkout_config on public.business_documents;
create trigger sync_cafe_checkout_config
after insert or update of data on public.business_documents
for each row
when (new.name = 'master')
execute function public.sync_cafe_checkout_config();

insert into public.cafe_checkout_config (name, tax_rate, business_days)
select name,
  coalesce(nullif(data#>>'{business,taxRate}', '')::numeric, 0),
  case
    when jsonb_typeof(data->'businessDays') = 'array' then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', d->>'key',
        'finalized', coalesce((d->>'finalized')::boolean, false),
        'posClosed', coalesce((d->>'posClosed')::boolean, false)
      )), '[]'::jsonb)
      from jsonb_array_elements(data->'businessDays') d
    )
    else '[]'::jsonb
  end
from public.business_documents
where name = 'master'
on conflict (name) do update
  set tax_rate = excluded.tax_rate,
      business_days = excluded.business_days;

create index if not exists recipes_menu_name_idx on public.recipes (menu_name);
create index if not exists order_items_table_menu_idx on public.order_items (table_id, menu_item_id);

alter table public.cafe_checkout_config enable row level security;

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
  days jsonb;
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
    return existing_sale.result || jsonb_build_object('replayed', true);
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

  select c.tax_rate, c.business_days
    into tax_rate, days
    from public.cafe_checkout_config c
   where c.name = 'master';
  tax_rate := coalesce(tax_rate, 0);
  if prof.role = 'admin' and p_time is not null then
    now_ts := p_time;
  end if;
  if prof.role = 'admin' and p_business_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    day_key := p_business_day;
  else
    day_key := public.business_day_key(now_ts);
  end if;
  if days is not null then
    select d into day_row
      from jsonb_array_elements(days) d
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
