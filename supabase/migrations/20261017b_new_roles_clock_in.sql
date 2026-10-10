-- RUN THIS SECOND (after the first has finished). Lets the new roles clock in.
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
  if not exists (select 1 from public.profiles where id = uid and is_active and role::text in ('teacher', 'bursar', 'staff', 'messenger', 'headteacher', 'storekeeper')) then
    raise exception 'Not allowed';
  end if;
  select token into tok from public.staff_qr_secret where id = 1;
  if tok is null or p_token is distinct from tok then raise exception 'Invalid QR code. Please scan the official campus code.'; end if;
  if extract(isodow from accra) > 5 then raise exception 'Attendance is only taken on school days, Monday to Friday.'; end if;

  if p_action = 'in' then
    if mins < 360 then raise exception 'Check-in opens at 6:00 AM.'; end if;
    if mins > 720 then raise exception 'Check-in closed at 12:00 PM. You are marked absent today.'; end if;
    insert into public.staff_attendance (teacher_id, date, clock_in_at, status)
    values (uid, today, now(),
            case when mins <= 435 then 'Present'      -- up to 7:15
                 when mins <= 555 then 'Late'         -- 7:16 to 9:15
                 else 'Very Late' end)                -- 9:16 to 12:00
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
