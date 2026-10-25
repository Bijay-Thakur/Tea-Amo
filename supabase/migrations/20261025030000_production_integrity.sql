-- Guest payment charges the stored quote once, a failed reset rolls back,
-- and recipe replacement is a single transaction.

create or replace function public.reset_operational_data(
  p_next_data jsonb,
  p_expected_revision bigint,
  p_actor_id uuid,
  p_actor_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  doc public.business_documents;
  before_counts jsonb;
  after_counts jsonb;
  next_generation bigint;
  verified boolean := false;
begin
  select * into doc from public.business_documents where name = 'master' for update;
  if doc.name is null then
    raise exception 'master_missing';
  end if;
  if p_expected_revision is not null and doc.revision <> p_expected_revision then
    raise exception 'state_revision_conflict';
  end if;

  before_counts := public.reset_operational_preview() || jsonb_build_object(
    'bills', coalesce(jsonb_array_length(doc.data->'bills'), 0)
  );

  delete from public.sales;
  delete from public.live_orders;
  delete from public.inventory_movements;
  delete from public.guest_orders;

  update public.cafe_tables
     set attention = false,
         reservation = null,
         seated = false;

  update public.ingredients
     set stock = 0,
         avg_cost = 0;

  next_generation := coalesce(doc.operational_generation, 1) + 1;
  p_next_data := coalesce(p_next_data, '{}'::jsonb);
  p_next_data := p_next_data
    || jsonb_build_object('operationalGeneration', next_generation, 'tableOrders', '{}'::jsonb, 'bills', '[]'::jsonb);

  update public.business_documents
     set data = p_next_data,
         revision = doc.revision + 1,
         operational_generation = next_generation,
         updated_at = now()
   where name = 'master';

  after_counts := public.reset_operational_preview() || jsonb_build_object(
    'bills', coalesce(jsonb_array_length(p_next_data->'bills'), 0)
  );

  verified :=
    coalesce((after_counts->>'sales')::int, -1) = 0
    and coalesce((after_counts->>'sale_items')::int, -1) = 0
    and coalesce((after_counts->>'payments')::int, -1) = 0
    and coalesce((after_counts->>'live_orders')::int, -1) = 0
    and coalesce((after_counts->>'order_items')::int, -1) = 0
    and coalesce((after_counts->>'inventory_movements')::int, -1) = 0
    and coalesce((after_counts->>'guest_orders')::int, -1) = 0
    and coalesce((after_counts->>'bills')::int, -1) = 0;

  if not verified then
    raise exception 'reset_not_verified';
  end if;

  insert into public.reset_reports (kind, actor_id, actor_name, verified, generation, counts_before, counts_after, error)
  values (
    'complete_operational',
    p_actor_id,
    p_actor_name,
    true,
    next_generation,
    before_counts,
    after_counts,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'verified', true,
    'generation', next_generation,
    'revision', doc.revision + 1,
    'state', p_next_data,
    'counts_before', before_counts,
    'counts_after', after_counts
  );
end;
$$;

create or replace function public.complete_guest_payment(
  p_order_id uuid,
  p_payment text,
  p_payments jsonb,
  p_cash_received numeric,
  p_change_due numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prof public.profiles;
  guest public.guest_orders;
  existing_sale public.sales;
  days jsonb;
  day_key text;
  day_row jsonb;
  item jsonb;
  recipe record;
  used numeric;
  line_cogs numeric;
  total_cogs numeric := 0;
  sale_items jsonb := '[]'::jsonb;
  sel_subtotal numeric := 0;
  sel_tax numeric := 0;
  delivery_fee numeric := 0;
  sel_total numeric := 0;
  unit_price numeric;
  qty integer;
  bill_id text;
  bill jsonb;
  result jsonb;
  pay_method text;
  idem_key text;
  now_ts timestamptz := now();
begin
  select * into prof from public.profiles where id = auth.uid();
  if prof.id is null or not prof.active or prof.role not in ('admin', 'server_staff') then
    raise exception 'forbidden';
  end if;

  select * into guest from public.guest_orders where id = p_order_id for update;
  if guest.id is null then
    raise exception 'order_missing';
  end if;
  if guest.status in ('rejected', 'cancelled', 'failed') then
    raise exception 'guest_order_closed';
  end if;

  idem_key := 'gpay-' || replace(guest.id::text, '-', '');
  if guest.payment_status = 'paid' and guest.sale_id is not null then
    select * into existing_sale from public.sales where id = guest.sale_id;
    if existing_sale.id is not null then
      return existing_sale.result || jsonb_build_object('replayed', true);
    end if;
  end if;
  select * into existing_sale from public.sales where idempotency_key = idem_key;
  if existing_sale.id is not null then
    update public.guest_orders
       set payment_status = 'paid',
           sale_id = existing_sale.id,
           status = 'completed',
           updated_at = now()
     where id = guest.id;
    return existing_sale.result || jsonb_build_object('replayed', true);
  end if;

  select c.business_days into days from public.cafe_checkout_config c where c.name = 'master';
  day_key := public.business_day_key(now_ts);
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

  if coalesce(jsonb_array_length(guest.items), 0) < 1 then
    raise exception 'empty_payment';
  end if;

  sel_subtotal := coalesce(guest.subtotal, 0);
  sel_tax := coalesce(guest.tax, 0);
  delivery_fee := coalesce(guest.delivery_fee, 0);
  sel_total := coalesce(guest.total, sel_subtotal + sel_tax + delivery_fee);
  pay_method := coalesce(nullif(trim(p_payment), ''), 'Cash');
  if pay_method = 'Mixed' then
    if abs(coalesce((select sum(value::numeric) from jsonb_each_text(coalesce(p_payments, '{}'::jsonb))), 0) - sel_total) > 0.05 then
      raise exception 'payment_mismatch';
    end if;
  else
    p_payments := jsonb_build_object(pay_method, sel_total);
  end if;

  bill_id := 'TA-' || to_char(now_ts at time zone 'Asia/Kathmandu', 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  for item in select * from jsonb_array_elements(guest.items)
  loop
    qty := greatest(coalesce((item->>'qty')::integer, 0), 0);
    if qty = 0 then
      continue;
    end if;
    unit_price := coalesce((item->>'unit_price')::numeric, (item->>'price')::numeric, 0);
    line_cogs := 0;
    for recipe in
      select r.qty, i.key as ingredient_key, i.avg_cost
        from public.recipes r
        join public.ingredients i on i.key = r.ingredient_key
       where r.menu_name = coalesce(item->>'name', '')
    loop
      used := recipe.qty * qty;
      line_cogs := line_cogs + coalesce(recipe.avg_cost, 0) * used;
      update public.ingredients set stock = stock - used where key = recipe.ingredient_key;
      insert into public.inventory_movements (ingredient_key, qty_delta, reason, ref, note)
      values (recipe.ingredient_key, -used, 'sale', bill_id, item->>'name');
    end loop;
    total_cogs := total_cogs + line_cogs;
    sale_items := sale_items || jsonb_build_array(jsonb_build_object(
      'id', item->>'menu_item_id',
      'name', coalesce(item->>'name', 'Item'),
      'price', unit_price,
      'qty', qty,
      'served_qty', qty,
      'cogs', line_cogs
    ));
  end loop;

  bill := jsonb_build_object(
    'id', bill_id,
    'time', now_ts,
    'businessDay', day_key,
    'type', case when guest.fulfillment = 'delivery' then 'Delivery' else 'Takeaway' end,
    'ref', guest.public_ref,
    'table_id', null,
    'guest_count', 1,
    'payment', pay_method,
    'payments', coalesce(p_payments, '{}'::jsonb),
    'cash_received', coalesce(p_cash_received, sel_total),
    'change_due', coalesce(p_change_due, 0),
    'items', sale_items,
    'subtotal', sel_subtotal,
    'discount', 0,
    'tax', sel_tax,
    'delivery_fee', delivery_fee,
    'total', sel_total,
    'cogs', total_cogs,
    'source', 'guest',
    'guest_order_id', guest.id,
    'completed_by', prof.display_name,
    'completed_by_role', prof.role
  );

  result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'bill', bill,
    'table_id', null,
    'table_closed', false,
    'version', 0
  );

  insert into public.sales (id, table_id, business_day, total, payment, bill, result, actor_id, actor_role, actor_name, idempotency_key)
  values (
    bill_id, null, day_key, sel_total,
    pay_method, bill, result, prof.id, prof.role, prof.display_name, idem_key
  );
  insert into public.sale_items (sale_id, menu_item_id, name, unit_price, qty, served_qty, cogs)
  select bill_id, s->>'id', s->>'name', (s->>'price')::numeric, (s->>'qty')::integer, (s->>'served_qty')::integer, (s->>'cogs')::numeric
    from jsonb_array_elements(sale_items) s;
  insert into public.payments (sale_id, idempotency_key, method, amount, breakdown)
  values (bill_id, idem_key, pay_method, sel_total, coalesce(p_payments, '{}'::jsonb));

  update public.guest_orders
     set payment_status = 'paid',
         sale_id = bill_id,
         status = 'completed',
         updated_at = now()
   where id = guest.id;

  perform public.write_audit(
    'GUEST_PAYMENT_COMPLETED', 'guest_order', guest.id::text,
    jsonb_build_object('sale_id', bill_id, 'total', sel_total, 'payment', pay_method)
  );

  return result;
exception
  when unique_violation then
    select * into existing_sale from public.sales where idempotency_key = idem_key;
    if existing_sale.id is not null then
      update public.guest_orders
         set payment_status = 'paid',
             sale_id = existing_sale.id,
             status = 'completed',
             updated_at = now()
       where id = p_order_id;
      return existing_sale.result || jsonb_build_object('replayed', true);
    end if;
    raise;
end;
$$;

create or replace function public.replace_recipes(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  delete from public.recipes;
  insert into public.recipes (menu_name, ingredient_key, qty)
  select r->>'menu_name', r->>'ingredient_key', (r->>'qty')::numeric
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where coalesce(r->>'menu_name', '') <> ''
     and coalesce(r->>'ingredient_key', '') <> ''
     and coalesce((r->>'qty')::numeric, 0) > 0;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.complete_guest_payment(uuid, text, jsonb, numeric, numeric) from public, anon;
revoke all on function public.replace_recipes(jsonb) from public, anon, authenticated;
grant execute on function public.complete_guest_payment(uuid, text, jsonb, numeric, numeric) to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.complete_guest_payment(uuid, text, jsonb, numeric, numeric) to service_role;
    grant execute on function public.replace_recipes(jsonb) to service_role;
  end if;
end $$;
