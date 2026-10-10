-- Private storage for backups. Only the backup-data function (and admin uploads) can touch it.
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;

drop policy if exists "admin uploads backups" on storage.objects;
create policy "admin uploads backups" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'backups' and (storage.foldername(name))[1] = 'uploads'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role::text = 'admin')
  );
