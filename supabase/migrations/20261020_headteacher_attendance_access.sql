-- The headteacher can READ attendance: staff clock-ins, student registers and the staff list (not admin accounts). Nothing is writable.
drop policy if exists "headteacher read" on public.staff_attendance;
create policy "headteacher read" on public.staff_attendance for select to authenticated using ((select public.is_headteacher()));

drop policy if exists "headteacher read" on public.attendance;
create policy "headteacher read" on public.attendance for select to authenticated using ((select public.is_headteacher()));

drop policy if exists "headteacher read staff profiles" on public.profiles;
create policy "headteacher read staff profiles" on public.profiles for select to authenticated
  using ((select public.is_headteacher()) and role::text <> 'admin');
