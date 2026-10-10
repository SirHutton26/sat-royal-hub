-- Alerts can now be addressed to chosen staff, and remember how they were delivered.
alter table public.alerts add column if not exists audience text not null default 'all';
alter table public.alerts drop constraint if exists alerts_audience_check;
alter table public.alerts add constraint alerts_audience_check check (audience in ('all', 'selected'));
alter table public.alerts add column if not exists target_ids uuid[];
alter table public.alerts add column if not exists sender_role text;
alter table public.alerts add column if not exists recipient_count int;
alter table public.alerts add column if not exists push_sent int;
alter table public.alerts add column if not exists sms_sent int;
alter table public.alerts add column if not exists sms_failed int;

-- People only see alerts meant for everyone, meant for them, or sent by them (admin keeps full access through its own rule).
drop policy if exists "teacher read alerts" on public.alerts;
drop policy if exists "read alerts addressed to me" on public.alerts;
create policy "read alerts addressed to me" on public.alerts for select to authenticated
  using (audience = 'all' or auth.uid() = any(target_ids) or created_by = auth.uid());

-- One reminder run per day (stops the 11 AM job sending twice).
create table if not exists public.reminder_runs (
  run_date date primary key,
  summary jsonb,
  created_at timestamptz not null default now()
);
alter table public.reminder_runs enable row level security;  -- only the server function can use it
