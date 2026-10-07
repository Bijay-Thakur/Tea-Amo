-- Menu photos live in Supabase Storage. The menu row stores only the public URL.

alter table public.menu_items
  add column if not exists image_url text;

comment on column public.menu_items.image_url is
  'Public URL for the item photo in the menu-images bucket. Empty when the item has no photo.';

do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public)
  values ('menu-images', 'menu-images', true)
  on conflict (id) do update set public = true;
exception when others then
  null;
end $$;
