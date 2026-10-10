-- RUN THIS SECOND (after the first one has finished). Log table for sent SMS.
create table if not exists public.sms_broadcasts (
  id uuid primary key default gen_random_uuid(),
  sent_by uuid references auth.users(id) on delete set null,
  sender_name text,
  audience text not null,
  message text not null,
  total int not null default 0,
  sent int not null default 0,
  failed int not null default 0,
  failed_numbers jsonb,
  created_at timestamptz not null default now()
);
alter table public.sms_broadcasts enable row level security;
drop policy if exists "messenger and admin read sms log" on public.sms_broadcasts;
create policy "messenger and admin read sms log" on public.sms_broadcasts for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role in ('admin', 'messenger')));
