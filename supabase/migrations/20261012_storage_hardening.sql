-- Student photos: only the class teacher (or admin) may add/replace/delete a student's photo,
-- and anonymous visitors can no longer LIST the bucket. Photos live at <student_id>/<file>.

drop policy if exists "Public read student photos" on storage.objects;
drop policy if exists "teachers upload student photos" on storage.objects;
drop policy if exists "teachers replace student photos" on storage.objects;
drop policy if exists "teachers delete student photos" on storage.objects;

create policy "class teacher read student photos" on storage.objects for select to authenticated
  using (bucket_id = 'student-photos' and exists (
    select 1 from public.students s join public.classes c on c.id = s.class_id
    where s.id::text = (storage.foldername(name))[1] and c.teacher_id = auth.uid()));

create policy "class teacher upload student photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'student-photos' and exists (
    select 1 from public.students s join public.classes c on c.id = s.class_id
    where s.id::text = (storage.foldername(name))[1] and c.teacher_id = auth.uid()));

create policy "class teacher replace student photos" on storage.objects for update to authenticated
  using (bucket_id = 'student-photos' and exists (
    select 1 from public.students s join public.classes c on c.id = s.class_id
    where s.id::text = (storage.foldername(name))[1] and c.teacher_id = auth.uid()));

create policy "class teacher delete student photos" on storage.objects for delete to authenticated
  using (bucket_id = 'student-photos' and exists (
    select 1 from public.students s join public.classes c on c.id = s.class_id
    where s.id::text = (storage.foldername(name))[1] and c.teacher_id = auth.uid()));

-- Profile pictures: stop anonymous listing too (pictures still load by their link).
drop policy if exists "avatar images are publicly accessible" on storage.objects;
create policy "own avatar read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
