-- CASS (Continuous Assessment Score Sheet) for Basic 9 only.
--   * The admin opens a CASS window for an academic year (CASS page in the admin sidebar).
--   * JHS subject teachers who teach a subject in Basic 9 see it on their Exams page and enter, for each
--     student, the Year 1 and Year 2 CASS score (0-100) for THEIR subject.
-- Run once in the Supabase SQL editor (after the earlier migrations).

-- Is this class a Basic 9 (JHS) class? Same rule the report card uses in the app.
create or replace function public.is_basic9_class(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.classes c
    where c.id = cid and c.level_group = 'jhs' and c.name ~* '(basic|class|b)\s*-?\s*9\y'
  )
$$;
revoke all on function public.is_basic9_class(uuid) from public, anon;
grant execute on function public.is_basic9_class(uuid) to authenticated;

-- Does the signed-in teacher teach this subject in this class?
create or replace function public.teaches_subject(cid uuid, subj text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subject_assignments sa
    where sa.teacher_id = (select auth.uid()) and sa.class_id = cid and sa.subject = subj
  )
$$;
revoke all on function public.teaches_subject(uuid, text) from public, anon;
grant execute on function public.teaches_subject(uuid, text) to authenticated;

create table if not exists public.cass_sessions (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null unique,            -- e.g. '2026/2027'
  start_date date not null,
  end_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.cass_scores (
  id uuid primary key default gen_random_uuid(),
  cass_session_id uuid not null references public.cass_sessions(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject text not null,
  student_id uuid not null references public.students(id) on delete cascade,
  year1_score numeric(5, 2) check (year1_score is null or (year1_score >= 0 and year1_score <= 100)),
  year2_score numeric(5, 2) check (year2_score is null or (year2_score >= 0 and year2_score <= 100)),
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cass_session_id, class_id, subject, student_id)
);
create index if not exists cass_scores_lookup_idx on public.cass_scores (cass_session_id, class_id, subject);

alter table public.cass_sessions enable row level security;
alter table public.cass_scores enable row level security;

-- cass_sessions: admin manages; teachers and the headteacher can read
drop policy if exists "admin manages" on public.cass_sessions;
create policy "admin manages" on public.cass_sessions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "staff read" on public.cass_sessions;
create policy "staff read" on public.cass_sessions for select to authenticated
  using ((select public.is_headteacher()) or exists (
    select 1 from public.subject_assignments sa where sa.teacher_id = (select auth.uid())
  ));

-- cass_scores: admin and headteacher read; a subject teacher reads/writes only their own subject in Basic 9,
-- and only writes while the window is switched on and today is inside it
drop policy if exists "admin manages" on public.cass_scores;
create policy "admin manages" on public.cass_scores for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "headteacher read" on public.cass_scores;
create policy "headteacher read" on public.cass_scores for select to authenticated
  using ((select public.is_headteacher()));
drop policy if exists "subject teacher read" on public.cass_scores;
create policy "subject teacher read" on public.cass_scores for select to authenticated
  using (public.is_basic9_class(class_id) and public.teaches_subject(class_id, subject));

create or replace function public.cass_window_open(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.cass_sessions s
    where s.id = sid and s.is_active and current_date between s.start_date and s.end_date
  )
$$;
revoke all on function public.cass_window_open(uuid) from public, anon;
grant execute on function public.cass_window_open(uuid) to authenticated;

drop policy if exists "subject teacher insert" on public.cass_scores;
create policy "subject teacher insert" on public.cass_scores for insert to authenticated
  with check (public.is_basic9_class(class_id) and public.teaches_subject(class_id, subject) and public.cass_window_open(cass_session_id));
drop policy if exists "subject teacher update" on public.cass_scores;
create policy "subject teacher update" on public.cass_scores for update to authenticated
  using (public.is_basic9_class(class_id) and public.teaches_subject(class_id, subject) and public.cass_window_open(cass_session_id))
  with check (public.is_basic9_class(class_id) and public.teaches_subject(class_id, subject) and public.cass_window_open(cass_session_id));
drop policy if exists "subject teacher delete" on public.cass_scores;
create policy "subject teacher delete" on public.cass_scores for delete to authenticated
  using (public.is_basic9_class(class_id) and public.teaches_subject(class_id, subject) and public.cass_window_open(cass_session_id));

-- keep updated_at fresh
create or replace function public.cass_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_cass_touch on public.cass_scores;
create trigger trg_cass_touch before update on public.cass_scores for each row execute function public.cass_touch();

-- deactivated accounts get nothing, same as every other table
do $$
declare t text;
begin
  foreach t in array array['cass_sessions', 'cass_scores'] loop
    execute format('drop policy if exists "active accounts only" on public.%I', t);
    execute format('create policy "active accounts only" on public.%I as restrictive for all to authenticated using ((select public.is_active_user())) with check ((select public.is_active_user()))', t);
    -- activity log (who changed what)
    if to_regprocedure('public.log_activity()') is not null then
      execute format('drop trigger if exists trg_activity_log on public.%I', t);
      execute format('create trigger trg_activity_log after insert or update or delete on public.%I for each row execute function public.log_activity()', t);
    end if;
  end loop;
end $$;
