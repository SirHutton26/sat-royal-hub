-- Scheme of learning (the government's weekly plan for each class and subject) and weekly lesson plans.
-- The private school runs a number of weeks ahead of the government schedule: school_settings.scheme_week_offset.
-- Safe to run more than once.

-- ---------------------------------------------------------------- the scheme: one row per class, subject, term and week
create table if not exists public.scheme_weeks (
  id            uuid primary key default gen_random_uuid(),
  academic_year text    not null,                       -- '2026/2027'
  term          text    not null,                       -- 'Term 1'
  class_name    text    not null,                       -- 'Basic 7'
  subject       text    not null,                       -- as written in the scheme, e.g. 'Computing'
  subject_key   text    not null,                       -- same subject under any name the school uses: 'computing', 'maths', 'rme' ...
  week_no       integer not null check (week_no between 1 and 20),
  kind          text    not null default 'lesson' check (kind in ('lesson', 'revision', 'exam', 'sba')),
  topic         text,                                   -- the week's topic from the annual overview
  items         jsonb   not null default '[]',          -- [{ strand, sub_strand, content_standard, indicators: [{code, text}], resources }]
  created_at    timestamptz not null default now()
);
create unique index if not exists scheme_weeks_one_per_week on public.scheme_weeks (academic_year, term, lower(class_name), subject_key, week_no);
create index if not exists scheme_weeks_lookup_idx on public.scheme_weeks (lower(class_name), academic_year, term);

alter table public.scheme_weeks enable row level security;
grant select, insert, update, delete on public.scheme_weeks to authenticated;
drop policy if exists "signed in users read the scheme" on public.scheme_weeks;
create policy "signed in users read the scheme" on public.scheme_weeks for select to authenticated using (true);
drop policy if exists "admin manages the scheme" on public.scheme_weeks;
create policy "admin manages the scheme" on public.scheme_weeks for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------- how far ahead of the government schedule the school is
alter table public.school_settings add column if not exists scheme_week_offset integer not null default 0;

-- The headteacher and admin set it (school_settings itself may only be editable by the admin)
create or replace function public.set_scheme_week_offset(p_weeks integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ((select public.is_admin()) or (select public.is_headteacher())) then
    raise exception 'Only the headteacher or the admin can change this';
  end if;
  if p_weeks < 0 or p_weeks > 6 then raise exception 'Choose between 0 and 6 weeks'; end if;
  update public.school_settings set scheme_week_offset = p_weeks;
end $$;
revoke all on function public.set_scheme_week_offset(integer) from public;
grant execute on function public.set_scheme_week_offset(integer) to authenticated;

-- ---------------------------------------------------------------- weekly plans are saved as one lesson plan per day
alter table public.lesson_plans add column if not exists week_group    uuid;     -- the lessons written together for one week share this
alter table public.lesson_plans add column if not exists scheme_week_id uuid;
alter table public.lesson_plans add column if not exists week_no       integer;
alter table public.lesson_plans add column if not exists term          text;
alter table public.lesson_plans add column if not exists academic_year text;
create index if not exists lesson_plans_week_group_idx on public.lesson_plans (week_group) where week_group is not null;
