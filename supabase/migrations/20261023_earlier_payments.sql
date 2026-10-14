-- Payments made BEFORE the system started: kept separate from today's takings, with their own numbers (EP-00001...).
alter table public.fee_payments add column if not exists source text not null default 'system';
alter table public.fee_payments drop constraint if exists fee_payments_source_check;
alter table public.fee_payments add constraint fee_payments_source_check check (source in ('system', 'before_system'));

create sequence if not exists public.fee_earlier_seq;

create or replace function public.set_fee_receipt_no() returns trigger
language plpgsql as $$
begin
  if new.source = 'before_system' then
    new.receipt_no := 'EP-' || lpad(nextval('public.fee_earlier_seq')::text, 5, '0');
  else
    new.receipt_no := 'SAT-' || to_char(now(), 'YY') || '-' || lpad(nextval('public.fee_receipt_seq')::text, 8, '0');
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
