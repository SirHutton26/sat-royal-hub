-- The admin (not the bursar) enters payments made BEFORE the system started, from the class sheet.
drop policy if exists "admin inserts earlier payments" on public.fee_payments;
create policy "admin inserts earlier payments" on public.fee_payments
  for insert to authenticated
  with check (public.is_admin() and source = 'before_system');

notify pgrst, 'reload schema';
