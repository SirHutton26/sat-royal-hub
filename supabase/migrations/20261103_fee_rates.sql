-- Daily / weekly fee rates set by the admin, shown in the report card's FEES REMINDER.
--   feeding : per day,  by level
--   extra   : per day,  one rate for everyone (level_group = '')
--   ict     : per week, by level
-- Run once in the Supabase SQL editor (needs is_admin_user() from 20261004_daily_collections.sql).
create table if not exists public.fee_rates (
  kind text not null check (kind in ('feeding', 'extra', 'ict')),
  level_group text not null default '',
  amount numeric(10,2) not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (kind, level_group)
);

alter table public.fee_rates enable row level security;
create policy "fee_rates read" on public.fee_rates for select to authenticated using (true);
create policy "fee_rates admin write" on public.fee_rates for all to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
