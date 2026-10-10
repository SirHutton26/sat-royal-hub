-- Activity log: who did what, recorded automatically by the database.
create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  user_name text,
  user_role text,
  action text not null,        -- create | update | delete | login
  entity text not null,        -- table name, or 'session'
  entity_id text,
  label text,                  -- e.g. the student's name or receipt number
  details jsonb
);
create index if not exists activity_log_created_idx on public.activity_log (created_at desc);
create index if not exists activity_log_user_idx on public.activity_log (user_id, created_at desc);
alter table public.activity_log enable row level security;

drop policy if exists "admin reads activity log" on public.activity_log;
create policy "admin reads activity log" on public.activity_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role::text = 'admin'));

-- Signed-in users may record their own login only
drop policy if exists "users log own login" on public.activity_log;
create policy "users log own login" on public.activity_log for insert to authenticated
  with check (user_id = auth.uid() and action = 'login' and entity = 'session');

create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb; o jsonb; k text;
  changed jsonb := '{}'::jsonb;
  uid uuid := auth.uid();
  p record;
begin
  if TG_OP = 'DELETE' then j := to_jsonb(OLD); else j := to_jsonb(NEW); end if;
  if TG_OP = 'UPDATE' then
    o := to_jsonb(OLD);
    for k in select jsonb_object_keys(j) loop
      if k in ('updated_at', 'alerts_last_seen_at') then continue; end if;
      if (j -> k) is distinct from (o -> k) then
        changed := changed || jsonb_build_object(k, jsonb_build_object('from', o -> k, 'to', j -> k));
      end if;
    end loop;
    if changed = '{}'::jsonb then return null; end if;   -- nothing meaningful changed
  end if;

  select full_name, email, role::text as role into p from public.profiles where id = uid;

  insert into public.activity_log (user_id, user_name, user_role, action, entity, entity_id, label, details)
  values (
    uid,
    case when uid is null then 'System' else coalesce(p.full_name, p.email) end,
    p.role,
    case TG_OP when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
    TG_TABLE_NAME,
    j ->> 'id',
    coalesce(j ->> 'full_name', j ->> 'name', j ->> 'title', j ->> 'receipt_no', j ->> 'subject', j ->> 'item', j ->> 'date'),
    case when TG_OP = 'UPDATE' then changed else j end
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'students','classes','profiles','subjects','subject_assignments','school_settings','non_teaching_staff',
    'alerts','fee_structures','fee_payments','attendance','staff_attendance','exam_sessions','exam_scores',
    'score_bank_entries','score_bank_scores','sba_configs','sba_results','grades',
    'daily_collections','daily_feeding','daily_fee_rates','weekly_class_fee_remittances'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_activity_log on public.%I', t);
      execute format('create trigger trg_activity_log after insert or update or delete on public.%I for each row execute function public.log_activity()', t);
    end if;
  end loop;
end $$;
