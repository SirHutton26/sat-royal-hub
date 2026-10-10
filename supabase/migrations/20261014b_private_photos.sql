-- Make student photos private. The app now loads them through links that expire after an hour.
update storage.buckets set public = false where id = 'student-photos';

-- Old rows stored a full public link; keep just the file path (the app understands both).
update public.students
set photo_url = regexp_replace(photo_url, '^.*/student-photos/([^?]+).*$', '\1')
where photo_url like 'http%student-photos/%';

-- Who may view photos (class teachers and admin already can). Add the bursar and subject teachers.
drop policy if exists "bursar read student photos" on storage.objects;
create policy "bursar read student photos" on storage.objects for select to authenticated
  using (bucket_id = 'student-photos' and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role::text = 'bursar'));

drop policy if exists "subject teacher read student photos" on storage.objects;
create policy "subject teacher read student photos" on storage.objects for select to authenticated
  using (bucket_id = 'student-photos' and exists (
    select 1 from public.students s join public.subject_assignments sa on sa.class_id = s.class_id
    where s.id::text = (storage.foldername(objects.name))[1] and sa.teacher_id = auth.uid()));
