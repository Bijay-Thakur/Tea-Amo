-- A completed sale and the released seat must become visible together.
create or replace function public.release_paid_table()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.table_id is not null and coalesce((new.result->>'table_closed')::boolean, false) then
    update public.cafe_tables set seated = false where id = new.table_id;
  end if;
  return new;
end;
$$;

drop trigger if exists release_paid_table_after_sale on public.sales;
create trigger release_paid_table_after_sale
after insert on public.sales
for each row execute function public.release_paid_table();
