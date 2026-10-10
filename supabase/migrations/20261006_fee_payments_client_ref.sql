-- Makes offline payment replays safe: the same payment can never be saved twice.
alter table public.fee_payments add column if not exists client_ref text;
create unique index if not exists fee_payments_client_ref_key on public.fee_payments (client_ref) where client_ref is not null;
