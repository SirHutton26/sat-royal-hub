-- Allow the new 'staff' login role (non-teaching staff other than the bursar).
-- Run once in the Supabase SQL editor.

-- If profiles.role is a CHECK constraint (the common setup):
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'teacher', 'bursar', 'staff'));

-- If profiles.role is a Postgres enum instead, the two statements above will fail; run this one instead:
-- alter type public.user_role add value if not exists 'staff';   -- use your enum's actual name

-- The bursar (and staff) now go through first-login setup like teachers do.
-- Mark accounts that already exist as done, so nobody who is already using the hub is forced through it.
update public.profiles set onboarding_completed = true where role in ('bursar', 'admin');

-- Admin must be able to read/update staff profiles and the attendance of staff.
-- If your RLS policies for teachers are written as "role = 'teacher'", mirror them for 'staff', e.g.:
--   staff_attendance insert/update/select for own rows where teacher_id = auth.uid()
-- (the bursar already clocks in with the same table, so if that works, 'staff' will too
--  provided the policy is by teacher_id = auth.uid() and not by role).
