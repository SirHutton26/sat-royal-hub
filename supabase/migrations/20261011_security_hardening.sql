-- 1) CRITICAL: stop users from making themselves admin.
--    The "update own profile" policy lets a user change ANY column of their own row, including role.
create or replace function public.protect_profile_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null for the SQL editor and for server functions (service role), so those still work
  if auth.uid() is not null and not public.is_admin() then
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.is_active is distinct from old.is_active then
      raise exception 'You cannot change your role or active status';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_profile on public.profiles;
create trigger trg_protect_profile before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- 2) The bursar's "void" policy lets them edit ANY column of a payment (amount, student, receipt number...).
--    Only voiding should be possible.
create or replace function public.protect_payment_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and (
       new.amount is distinct from old.amount
    or new.student_id is distinct from old.student_id
    or new.fee_structure_id is distinct from old.fee_structure_id
    or new.receipt_no is distinct from old.receipt_no
    or new.received_by is distinct from old.received_by) then
    raise exception 'A payment cannot be edited. Void it and record a new one.';
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_payment on public.fee_payments;
create trigger trg_protect_payment before update on public.fee_payments
  for each row execute function public.protect_payment_columns();
