-- Store-keeper module: items, daily sales (money per item per day), and the money submitted each day.
create or replace function public.is_storekeeper() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and is_active and role::text = 'storekeeper')
$$;
revoke all on function public.is_storekeeper() from public, anon;
grant execute on function public.is_storekeeper() to authenticated;

create table if not exists public.store_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('school', 'parent')),  -- school = the school's own goods, parent = sold for parents
  commission_rate numeric(5, 2) check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 100)),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.store_sales (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null,
  item_id uuid not null references public.store_items(id) on delete cascade,
  amount numeric(10, 2) not null check (amount >= 0),             -- money made from this item that day
  commission numeric(10, 2) not null default 0 check (commission >= 0), -- the school's cut (parent items only)
  recorded_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (sale_date, item_id),
  check (commission <= amount)
);
create index if not exists store_sales_date_idx on public.store_sales (sale_date);

create table if not exists public.store_submissions (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null unique,
  amount_submitted numeric(10, 2) not null check (amount_submitted >= 0),
  note text,
  recorded_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['store_items', 'store_sales', 'store_submissions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "storekeeper manages" on public.%I', t);
    execute format('create policy "storekeeper manages" on public.%I for all to authenticated using ((select public.is_storekeeper())) with check ((select public.is_storekeeper()))', t);
    execute format('drop policy if exists "admin manages" on public.%I', t);
    execute format('create policy "admin manages" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    -- deactivated accounts get nothing, same as every other table
    execute format('drop policy if exists "active accounts only" on public.%I', t);
    execute format('create policy "active accounts only" on public.%I as restrictive for all to authenticated using ((select public.is_active_user())) with check ((select public.is_active_user()))', t);
    -- activity log (who changed what)
    if to_regprocedure('public.log_activity()') is not null then
      execute format('drop trigger if exists trg_activity_log on public.%I', t);
      execute format('create trigger trg_activity_log after insert or update or delete on public.%I for each row execute function public.log_activity()', t);
    end if;
  end loop;
end $$;

-- Starting items (the store-keeper can change these on the Items page)
insert into public.store_items (name, kind, sort_order) values
  ('Sobolo', 'parent', 1), ('Shortbread', 'parent', 2), ('Spring roll', 'parent', 3),
  ('Water', 'school', 4), ('Drinks', 'school', 5), ('Biscuits', 'school', 6), ('Writing materials', 'school', 7)
on conflict (name) do nothing;
