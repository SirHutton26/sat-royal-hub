-- Secure staff clock-in: the QR secret lives in an admin-only table, and the SERVER decides the time and status.

-- 1) Secret token, readable by admins only (school_settings is readable by every signed-in user).
create table if not exists public.staff_qr_secret (
  id int primary key default 1 check (id = 1),
  token text not null
);
alter table public.staff_qr_secret enable row level security;
drop policy if exists "admin manages qr secret" on public.staff_qr_secret;
create policy "admin manages qr secret" on public.staff_qr_secret for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- Fresh token: the old one was written into the app's code, so it must be replaced. Reprint the QR afterwards.
insert into public.staff_qr_secret (id, token)
values (1, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (id) do update set token = excluded.token;
-- The old column cannot be NULL, so overwrite it with an unrelated random value (it is no longer used).
update public.school_settings set staff_qr_token = replace(gen_random_uuid()::text, '-', '');

-- 2) The only way to clock in or out.
create or replace function public.staff_clock(p_action text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  tok text;
  accra timestamp := (now() at time zone 'Africa/Accra');
  today date := (now() at time zone 'Africa/Accra')::date;
  mins int := extract(hour from (now() at time zone 'Africa/Accra'))::int * 60
            + extract(minute from (now() at time zone 'Africa/Accra'))::int;
  rec public.staff_attendance;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.profiles where id = uid and is_active and role::text in ('teacher', 'bursar', 'staff', 'messenger')) then
    raise exception 'Not allowed';
  end if;
  select token into tok from public.staff_qr_secret where id = 1;
  if tok is null or p_token is distinct from tok then raise exception 'Invalid QR code. Please scan the official campus code.'; end if;
  if extract(isodow from accra) > 5 then raise exception 'Attendance is only taken on school days, Monday to Friday.'; end if;

  if p_action = 'in' then
    if mins < 360 or mins > 555 then raise exception 'Check-in is open from 6:00 AM to 9:15 AM.'; end if;
    insert into public.staff_attendance (teacher_id, date, clock_in_at, status)
    values (uid, today, now(), case when mins > 435 then 'Late' else 'Present' end)
    on conflict (teacher_id, date) do nothing;
  elsif p_action = 'out' then
    if mins < 900 or mins > 1080 then raise exception 'Sign-out is open from 3:00 PM to 6:00 PM.'; end if;
    update public.staff_attendance set clock_out_at = now()
      where teacher_id = uid and date = today and clock_in_at is not null and clock_out_at is null;
  else
    raise exception 'Unknown action';
  end if;

  select * into rec from public.staff_attendance where teacher_id = uid and date = today;
  if rec.id is null then raise exception 'You have not checked in today.'; end if;
  return jsonb_build_object('id', rec.id, 'clock_in_at', rec.clock_in_at, 'clock_out_at', rec.clock_out_at, 'status', rec.status);
end $$;
revoke all on function public.staff_clock(text, text) from public, anon;
grant execute on function public.staff_clock(text, text) to authenticated;

-- 3) No more direct writes to staff_attendance from the app (it used to let anyone edit their own times).
drop policy if exists "teacher manage own staff attendance" on public.staff_attendance;
drop policy if exists "bursar clocks in own staff attendance" on public.staff_attendance;
drop policy if exists "bursar clocks out own staff attendance" on public.staff_attendance;
drop policy if exists "staff read own attendance" on public.staff_attendance;
create policy "staff read own attendance" on public.staff_attendance for select to authenticated
  using (teacher_id = auth.uid());
revoke insert, update, delete on public.staff_attendance from authenticated;
