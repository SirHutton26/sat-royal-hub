-- Daily collections the bursar takes Monday to Friday:
--   * daily school fee   (creche to Basic 1, e.g. GH₵10 per pupil present)
--   * daily class fee    (creche to Basic 9, e.g. GH₵1 per pupil present; handed to the headteacher every Friday)
--   * daily feeding fee  (one total per day)
-- Run once in the Supabase SQL editor. Assumes classes.id is a uuid (change the types below if it is not).

create or replace function public.is_bursar_or_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role in ('admin', 'bursar')
  );
$$;

create or replace function public.is_admin_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role = 'admin'
  );
$$;

-- What each class pays per pupil per day (set by the admin)
create table if not exists public.daily_fee_rates (
  class_id uuid primary key references public.classes(id) on delete cascade,
  school_fee numeric(10,2) not null default 0 check (school_fee >= 0),
  class_fee numeric(10,2) not null default 0 check (class_fee >= 0),
  updated_at timestamptz not null default now()
);

-- One row per class per school day: how many pupils paid and what that came to
create table if not exists public.daily_collections (
  id uuid primary key default gen_random_uuid(),
  date date not null check (extract(isodow from date) <= 5),
  class_id uuid not null references public.classes(id) on delete cascade,
  students_present int not null default 0 check (students_present >= 0),
  students_paying int not null default 0 check (students_paying >= 0),
  school_fee_rate numeric(10,2) not null default 0,
  class_fee_rate numeric(10,2) not null default 0,
  school_fee_total numeric(10,2) not null default 0,
  class_fee_total numeric(10,2) not null default 0,
  recorded_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (date, class_id)
);

-- Total feeding fee collected each day
create table if not exists public.daily_feeding (
  date date primary key check (extract(isodow from date) <= 5),
  amount numeric(10,2) not null default 0 check (amount >= 0),
  note text,
  recorded_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

-- Friday hand-over of the week's class fees to the headteacher
create table if not exists public.weekly_class_fee_remittances (
  week_start date primary key check (extract(isodow from week_start) = 1),
  amount numeric(10,2) not null check (amount >= 0),
  note text,
  submitted_at timestamptz not null default now(),
  submitted_by uuid default auth.uid()
);

alter table public.daily_fee_rates enable row level security;
alter table public.daily_collections enable row level security;
alter table public.daily_feeding enable row level security;
alter table public.weekly_class_fee_remittances enable row level security;

drop policy if exists daily_fee_rates_read on public.daily_fee_rates;
drop policy if exists daily_fee_rates_write on public.daily_fee_rates;
create policy daily_fee_rates_read on public.daily_fee_rates for select using (public.is_bursar_or_admin());
create policy daily_fee_rates_write on public.daily_fee_rates for all using (public.is_admin_user()) with check (public.is_admin_user());

drop policy if exists daily_collections_all on public.daily_collections;
create policy daily_collections_all on public.daily_collections for all
  using (public.is_bursar_or_admin()) with check (public.is_bursar_or_admin());

drop policy if exists daily_feeding_all on public.daily_feeding;
create policy daily_feeding_all on public.daily_feeding for all
  using (public.is_bursar_or_admin()) with check (public.is_bursar_or_admin());

drop policy if exists weekly_remittances_all on public.weekly_class_fee_remittances;
create policy weekly_remittances_all on public.weekly_class_fee_remittances for all
  using (public.is_bursar_or_admin()) with check (public.is_bursar_or_admin());

-- Pupils present (present or late) per class on a day, from the teachers' registers.
-- A function, so the bursar needs no direct access to the attendance table.
create or replace function public.daily_present_counts(p_date date)
returns table (class_id uuid, present bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_bursar_or_admin() then
    raise exception 'Not allowed';
  end if;
  return query
    select a.class_id, count(*) filter (where a.status in ('present', 'late'))
    from public.attendance a
    where a.date = p_date
    group by a.class_id;
end;
$$;
grant execute on function public.daily_present_counts(date) to authenticated;
