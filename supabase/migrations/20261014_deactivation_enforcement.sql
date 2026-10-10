-- Deactivated accounts lose ALL database and file access immediately (even with a still-valid login).
-- BEFORE RUNNING: check nobody important is switched off by mistake (especially the admin):
--   select id, full_name, role, is_active from public.profiles where is_active is not true;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false)
$$;
revoke all on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated;

-- A RESTRICTIVE rule is combined (AND) with every existing rule, so one per table is enough.
-- profiles is left out so a deactivated user can still read their own record and be shown "account inactive".
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and rowsecurity and tablename <> 'profiles' loop
    execute format('drop policy if exists "active accounts only" on public.%I', r.tablename);
    execute format(
      'create policy "active accounts only" on public.%I as restrictive for all to authenticated using ((select public.is_active_user())) with check ((select public.is_active_user()))',
      r.tablename);
  end loop;
end $$;

drop policy if exists "active accounts only" on storage.objects;
create policy "active accounts only" on storage.objects as restrictive for all to authenticated
  using ((select public.is_active_user())) with check ((select public.is_active_user()));

-- NOTE: any table you create LATER needs the same policy (copy the create policy line above).
