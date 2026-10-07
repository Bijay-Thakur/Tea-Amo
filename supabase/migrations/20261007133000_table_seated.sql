alter table public.cafe_tables
  add column if not exists seated boolean not null default false;
