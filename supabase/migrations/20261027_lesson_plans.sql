-- AI lesson plans: the NaCCA curriculum (loaded by the admin), each teacher's saved plans, and a usage log
-- that limits how many plans a teacher can generate per day (the AI free tier is shared by the whole school).
-- Safe to run more than once.

-- ---------------------------------------------------------------- curriculum
-- One row per indicator. Strand, sub-strand and content standard repeat on every row; the app groups them.
create table if not exists public.curriculum_items (
  id                    uuid primary key default gen_random_uuid(),
  class_name            text not null,        -- as named in Classes, e.g. 'Basic 7' (matched ignoring capital letters)
  subject               text not null,        -- as named in Subjects, e.g. 'Computing'
  strand                text not null,
  sub_strand            text not null,
  content_standard_code text,                 -- e.g. B7.1.1.1
  content_standard      text not null,
  indicator_code        text,                 -- e.g. B7.1.1.1.1
  indicator             text not null,
  exemplar              text,                 -- the curriculum's suggested activities for the indicator (optional)
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now()
);
create index if not exists curriculum_items_lookup_idx on public.curriculum_items (lower(class_name), lower(subject), sort_order);

alter table public.curriculum_items enable row level security;
grant select, insert, update, delete on public.curriculum_items to authenticated;

drop policy if exists "signed in users read curriculum" on public.curriculum_items;
create policy "signed in users read curriculum" on public.curriculum_items for select to authenticated using (true);

drop policy if exists "admin manages curriculum" on public.curriculum_items;
create policy "admin manages curriculum" on public.curriculum_items for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------- saved lesson plans
-- Plans are created only by the generate-lesson-plan function (service role), so there is no insert policy here.
create table if not exists public.lesson_plans (
  id               uuid primary key default gen_random_uuid(),
  teacher_id       uuid not null references public.profiles (id) on delete cascade,
  title            text not null,
  class_name       text not null,
  subject          text not null,
  strand           text,
  sub_strand       text,
  content_standard text,
  indicators       jsonb not null default '[]',   -- [{ "code": "...", "text": "..." }]
  duration_minutes integer not null,
  class_size       integer,
  lesson_date      date,
  plan             jsonb not null,                -- the written plan (phases, activities, assessment ...)
  model            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists lesson_plans_teacher_idx on public.lesson_plans (teacher_id, created_at desc);

create or replace function public.lesson_plans_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists lesson_plans_touch on public.lesson_plans;
create trigger lesson_plans_touch before update on public.lesson_plans for each row execute function public.lesson_plans_touch();

alter table public.lesson_plans enable row level security;
grant select, update, delete on public.lesson_plans to authenticated;

drop policy if exists "teachers read own lesson plans" on public.lesson_plans;
create policy "teachers read own lesson plans" on public.lesson_plans for select to authenticated using (teacher_id = (select auth.uid()));
drop policy if exists "teachers edit own lesson plans" on public.lesson_plans;
create policy "teachers edit own lesson plans" on public.lesson_plans for update to authenticated
  using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
drop policy if exists "teachers delete own lesson plans" on public.lesson_plans;
create policy "teachers delete own lesson plans" on public.lesson_plans for delete to authenticated using (teacher_id = (select auth.uid()));

-- The headteacher and admin can read every plan (supervision)
drop policy if exists "headteacher reads lesson plans" on public.lesson_plans;
create policy "headteacher reads lesson plans" on public.lesson_plans for select to authenticated using ((select public.is_headteacher()));
drop policy if exists "admin reads lesson plans" on public.lesson_plans;
create policy "admin reads lesson plans" on public.lesson_plans for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------- daily usage log
-- One row per successful generation. Deleting a saved plan does not give the teacher a free extra generation.
create table if not exists public.lesson_plan_usage (
  id         bigint generated always as identity primary key,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists lesson_plan_usage_idx on public.lesson_plan_usage (teacher_id, created_at desc);

alter table public.lesson_plan_usage enable row level security;
grant select on public.lesson_plan_usage to authenticated;
drop policy if exists "teachers read own usage" on public.lesson_plan_usage;
create policy "teachers read own usage" on public.lesson_plan_usage for select to authenticated using (teacher_id = (select auth.uid()));
