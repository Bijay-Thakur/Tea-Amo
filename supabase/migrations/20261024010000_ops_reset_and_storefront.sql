-- Slim staff workspace reads, transactional operational reset, and guest storefront orders.
-- Privilege-sensitive work stays in private and is executed by the Worker with the service role.

create schema if not exists private;

alter table public.business_documents
  add column if not exists operational_generation bigint not null default 1;

alter table public.menu_items
  add column if not exists description text not null default '';

create table if not exists public.reset_reports (
  id bigint generated always as identity primary key,
  kind text not null,
  actor_id uuid,
  actor_name text,
  verified boolean not null default false,
  generation bigint,
  counts_before jsonb not null default '{}'::jsonb,
  counts_after jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.guest_orders (
  id uuid primary key default gen_random_uuid(),
  public_ref text not null unique,
  access_token text not null unique,
  status text not null default 'pending' check (status in (
    'pending', 'accepted', 'preparing', 'ready', 'dispatched', 'awaiting_pickup',
    'completed', 'rejected', 'cancelled', 'failed'
  )),
  fulfillment text not null check (fulfillment in ('delivery', 'pickup')),
  payment_method text not null,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'refunded')),
  customer_name text not null,
  customer_phone text not null,
  delivery_address text not null default '',
  landmark text not null default '',
  instructions text not null default '',
  items jsonb not null,
  subtotal numeric not null,
  tax numeric not null default 0,
  delivery_fee numeric not null default 0,
  total numeric not null,
  currency text not null default 'Rs',
  idempotency_key text not null unique,
  operational_generation bigint not null default 1,
  sale_id text,
  accepted_by uuid,
  accepted_by_name text,
  closed_reason text,
  contact_redacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists guest_orders_status_idx on public.guest_orders (status, created_at desc);
create index if not exists guest_orders_created_idx on public.guest_orders (created_at desc);

alter table public.reset_reports enable row level security;
alter table public.guest_orders enable row level security;

drop policy if exists reset_reports_admin_read on public.reset_reports;
create policy reset_reports_admin_read on public.reset_reports
  for select to authenticated
  using (public.is_admin());

drop policy if exists guest_orders_staff_read on public.guest_orders;
create policy guest_orders_staff_read on public.guest_orders
  for select to authenticated
  using (public.is_active_member());

drop policy if exists guest_orders_staff_update on public.guest_orders;
create policy guest_orders_staff_update on public.guest_orders
  for update to authenticated
  using (public.is_active_member())
  with check (public.is_active_member());

grant select on public.reset_reports to authenticated;
grant select, update on public.guest_orders to authenticated;

create or replace function public.workspace_business_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'name', coalesce(data#>>'{business,name}', 'TEA AMO'),
    'branch', coalesce(data#>>'{business,branch}', ''),
    'currency', coalesce(data#>>'{business,currency}', 'Rs'),
    'taxRate', coalesce(nullif(data#>>'{business,taxRate}', '')::numeric, 0),
    'payment_methods', coalesce(data#>'{business,payment_methods}', '[]'::jsonb),
    'generation', coalesce(operational_generation, 1)
  )
  from public.business_documents
  where name = 'master';
$$;

create or replace function public.payment_qr_for_method(p_method text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(data#>>array['business', 'payment_qr', p_method], '')
  from public.business_documents
  where name = 'master';
$$;

create or replace function public.reset_operational_preview()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'sales', (select count(*) from public.sales),
    'sale_items', (select count(*) from public.sale_items),
    'payments', (select count(*) from public.payments),
    'live_orders', (select count(*) from public.live_orders),
    'order_items', (select count(*) from public.order_items),
    'inventory_movements', (select count(*) from public.inventory_movements),
    'guest_orders', (select count(*) from public.guest_orders)
  );
$$;

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

  insert into public.reset_reports (kind, actor_id, actor_name, verified, generation, counts_before, counts_after, error)
  values (
    'complete_operational',
    p_actor_id,
    p_actor_name,
    verified,
    next_generation,
    before_counts,
    after_counts,
    case when verified then null else 'post_reset_counts_nonzero' end
  );

  if not verified then
    return jsonb_build_object(
      'ok', false,
      'verified', false,
      'error', 'Reset did not reach a clean empty operational state.',
      'generation', next_generation,
      'revision', doc.revision + 1,
      'counts_before', before_counts,
      'counts_after', after_counts
    );
  end if;

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

create or replace function public.place_guest_order(
  p_idempotency_key text,
  p_fulfillment text,
  p_payment_method text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_landmark text,
  p_instructions text,
  p_items jsonb,
  p_subtotal numeric,
  p_tax numeric,
  p_delivery_fee numeric,
  p_total numeric,
  p_currency text,
  p_generation bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.guest_orders;
  created public.guest_orders;
  current_generation bigint;
  day_key text;
begin
  if p_fulfillment not in ('delivery', 'pickup') then
    raise exception 'invalid_fulfillment';
  end if;
  if coalesce(jsonb_array_length(p_items), 0) < 1 then
    raise exception 'empty_order';
  end if;

  select * into existing from public.guest_orders where idempotency_key = p_idempotency_key;
  if existing.id is not null then
    return to_jsonb(existing);
  end if;

  select operational_generation into current_generation
    from public.business_documents
   where name = 'master';
  if current_generation is not null and p_generation is not null and current_generation <> p_generation then
    raise exception 'stale_generation';
  end if;

  day_key := to_char((now() at time zone 'Asia/Kathmandu'), 'YYYYMMDD');
  insert into public.guest_orders (
    public_ref, access_token, fulfillment, payment_method, customer_name, customer_phone,
    delivery_address, landmark, instructions, items, subtotal, tax, delivery_fee, total,
    currency, idempotency_key, operational_generation
  ) values (
    'TA-ON-' || day_key || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    p_fulfillment,
    p_payment_method,
    p_customer_name,
    p_customer_phone,
    coalesce(p_delivery_address, ''),
    coalesce(p_landmark, ''),
    coalesce(p_instructions, ''),
    p_items,
    p_subtotal,
    coalesce(p_tax, 0),
    coalesce(p_delivery_fee, 0),
    p_total,
    coalesce(p_currency, 'Rs'),
    p_idempotency_key,
    coalesce(current_generation, 1)
  ) returning * into created;

  return to_jsonb(created);
end;
$$;

create or replace function public.redact_expired_guest_contacts(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.guest_orders
     set customer_name = 'redacted',
         customer_phone = 'redacted',
         delivery_address = '',
         landmark = '',
         contact_redacted_at = now()
   where contact_redacted_at is null
     and status in ('completed', 'rejected', 'cancelled', 'failed')
     and created_at < now() - make_interval(days => greatest(1, p_days));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.workspace_business_config() from public, anon;
revoke all on function public.payment_qr_for_method(text) from public, anon;
revoke all on function public.reset_operational_preview() from public, anon;
revoke all on function public.reset_operational_data(jsonb, bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.place_guest_order(text, text, text, text, text, text, text, text, jsonb, numeric, numeric, numeric, numeric, text, bigint) from public, anon, authenticated;
revoke all on function public.redact_expired_guest_contacts(integer) from public, anon, authenticated;

grant execute on function public.workspace_business_config() to authenticated;
grant execute on function public.payment_qr_for_method(text) to authenticated;

alter table public.guest_orders replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.guest_orders;
  exception when duplicate_object then null;
  when undefined_object then null;
  end;
end $$;
