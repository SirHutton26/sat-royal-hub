-- Let signed-in users record their own page views, clicks, prints, logins and logouts (never create/update/delete rows).
drop policy if exists "users log own login" on public.activity_log;
drop policy if exists "users log own events" on public.activity_log;
create policy "users log own events" on public.activity_log for insert to authenticated
  with check (user_id = auth.uid() and action in ('login', 'logout', 'view', 'click', 'print'));
