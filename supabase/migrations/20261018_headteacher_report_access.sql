-- The headteacher can READ what the report cards need (classes, students, saved SBA results, fee records). Nothing is writable.
create or replace function public.is_headteacher() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and is_active and role::text = 'headteacher')
$$;
revoke all on function public.is_headteacher() from public, anon;
grant execute on function public.is_headteacher() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['classes', 'students', 'sba_results', 'fee_structures', 'fee_payments'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "headteacher read" on public.%I', t);
      execute format('create policy "headteacher read" on public.%I for select to authenticated using ((select public.is_headteacher()))', t);
    end if;
  end loop;
end $$;
