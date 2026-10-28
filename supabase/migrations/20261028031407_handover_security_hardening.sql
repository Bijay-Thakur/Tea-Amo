-- Only the server-side service role needs these document-reading RPCs.
revoke all on function public.workspace_business_config() from public, anon, authenticated;
revoke all on function public.payment_qr_for_method(text) from public, anon, authenticated;
revoke all on function public.reset_operational_preview() from public, anon, authenticated;

-- Trigger functions and the internal audit writer are never browser RPCs.
revoke all on function public.release_paid_table() from public, anon, authenticated;
revoke all on function public.sync_cafe_checkout_config() from public, anon, authenticated;
revoke all on function public.write_audit(text, text, text, jsonb) from public, anon, authenticated;

-- Membership helpers are used by authenticated RLS policies, never by guests.
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.is_active_member() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_member() to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.workspace_business_config() to service_role;
    grant execute on function public.payment_qr_for_method(text) to service_role;
    grant execute on function public.reset_operational_preview() to service_role;
  end if;
end $$;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create index if not exists live_orders_updated_by_idx on public.live_orders (updated_by);
create index if not exists recipes_ingredient_key_idx on public.recipes (ingredient_key);
create index if not exists sale_items_sale_id_idx on public.sale_items (sale_id);
