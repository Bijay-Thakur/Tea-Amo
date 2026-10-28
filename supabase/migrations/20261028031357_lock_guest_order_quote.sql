-- A guest quote is fixed at checkout. Staff sessions can move an order through
-- the kitchen, but they cannot rewrite the amount or mark it paid themselves.

create or replace function public.protect_guest_order_quote()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.items is distinct from old.items
     or new.subtotal is distinct from old.subtotal
     or new.tax is distinct from old.tax
     or new.delivery_fee is distinct from old.delivery_fee
     or new.total is distinct from old.total
  then
    raise exception 'guest_quote_locked';
  end if;
  return new;
end;
$$;

drop trigger if exists guest_orders_quote_lock on public.guest_orders;
create trigger guest_orders_quote_lock
  before update on public.guest_orders
  for each row
  execute function public.protect_guest_order_quote();

revoke update on table public.guest_orders from public, anon, authenticated;
grant update (
  status,
  accepted_by,
  accepted_by_name,
  closed_reason,
  contact_redacted_at,
  updated_at
) on table public.guest_orders to authenticated;
