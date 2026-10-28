-- Operational reset edits the stored café record in place.
-- The previous function received and returned the whole document, including payment QR
-- images, and the API role cancelled that statement before it could finish.

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
  next_data jsonb;
  cleared jsonb;
  verified boolean := false;
begin
  perform set_config('statement_timeout', '30s', true);

  select * into doc from public.business_documents where name = 'master' for update;
  if doc.name is null then
    raise exception 'master_missing';
  end if;
  if p_expected_revision is not null and doc.revision <> p_expected_revision then
    raise exception 'state_revision_conflict';
  end if;

  before_counts := public.reset_operational_preview() || jsonb_build_object(
    'bills', case when jsonb_typeof(doc.data->'bills') = 'array' then jsonb_array_length(doc.data->'bills') else 0 end
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
  next_data := coalesce(doc.data, '{}'::jsonb) || jsonb_build_object(
    'bills', '[]'::jsonb,
    'attendance', '[]'::jsonb,
    'purchases', '[]'::jsonb,
    'waste', '[]'::jsonb,
    'expenses', '[]'::jsonb,
    'customers', '[]'::jsonb,
    'complaints', '[]'::jsonb,
    'inventoryLog', '[]'::jsonb,
    'businessDays', '[]'::jsonb,
    'auditLog', '[]'::jsonb,
    'ownerCapital', '[]'::jsonb,
    'dailyBusinessReports', '[]'::jsonb,
    'accountTransfers', '[]'::jsonb,
    'cart', '[]'::jsonb,
    'tableOrders', '{}'::jsonb,
    'dashboardBaseline', null,
    'operationalGeneration', next_generation,
    'stateUpdatedAt', to_jsonb(now())
  );

  if jsonb_typeof(next_data->'ingredients') = 'array' then
    select coalesce(jsonb_agg((item || jsonb_build_object('stock', 0, 'avg_cost', 0)) order by ord), '[]'::jsonb)
      into cleared
      from jsonb_array_elements(next_data->'ingredients') with ordinality as t(item, ord);
    next_data := jsonb_set(next_data, '{ingredients}', cleared);
  end if;

  if jsonb_typeof(next_data->'staff') = 'array' then
    select coalesce(jsonb_agg((item || jsonb_build_object('clockIn', null)) order by ord), '[]'::jsonb)
      into cleared
      from jsonb_array_elements(next_data->'staff') with ordinality as t(item, ord);
    next_data := jsonb_set(next_data, '{staff}', cleared);
  end if;

  if jsonb_typeof(next_data->'tables') = 'array' then
    select coalesce(jsonb_agg((item || jsonb_build_object('attention', false, 'reservation', null, 'seated', false)) order by ord), '[]'::jsonb)
      into cleared
      from jsonb_array_elements(next_data->'tables') with ordinality as t(item, ord);
    next_data := jsonb_set(next_data, '{tables}', cleared);
  end if;

  update public.business_documents
     set data = next_data,
         revision = doc.revision + 1,
         operational_generation = next_generation,
         updated_at = now()
   where name = 'master';

  after_counts := public.reset_operational_preview() || jsonb_build_object(
    'bills', case when jsonb_typeof(next_data->'bills') = 'array' then jsonb_array_length(next_data->'bills') else 0 end
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
    'counts_before', before_counts,
    'counts_after', after_counts
  );
end;
$$;

revoke all on function public.reset_operational_data(jsonb, bigint, uuid, text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.reset_operational_data(jsonb, bigint, uuid, text) to service_role;
  end if;
end $$;
