-- Fix: inside the sub-query, the bare word "name" meant the CLASS name (classes.name), not the file name,
-- so no teacher could upload. Qualify it as objects.name.
drop policy if exists "class teacher read student photos" on storage.objects;
drop policy if exists "class teacher upload student photos" on storage.objects;
drop policy if exists "class teacher replace student photos" on storage.objects;
drop policy if exists "class teacher delete student photos" on storage.objects;

create policy "class teacher read student photos" on storage.objects for select to authenticated
  using (bucket_id = 'student-photos' and exists (
    select 1 from public.students s join public.classes c on c.id = s.class_id
    where s.id::text = (storage.foldername(objects.name))[1] and c.teacher_id = auth.uid()));

create policy "class teacher upload student photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'student-photos' and exists (
    select 1 from public.students s join public.classes c on c.id = s.class_id
    where s.id::text = (storage.foldername(objects.name))[1] and c.teacher_id = auth.uid()));

create policy "class teacher replace student photos" on storage.objects for update to authenticated
  using (bucket_id = 'student-photos' and exists (
    select 1 from public.students s join public.classes c on c.id = s.class_id
    where s.id::text = (storage.foldername(objects.name))[1] and c.teacher_id = auth.uid()))
  with check (bucket_id = 'student-photos' and exists (
    select 1 from public.students s join public.classes c on c.id = s.class_id
    where s.id::text = (storage.foldername(objects.name))[1] and c.teacher_id = auth.uid()));

create policy "class teacher delete student photos" on storage.objects for delete to authenticated
  using (bucket_id = 'student-photos' and exists (
    select 1 from public.students s join public.classes c on c.id = s.class_id
    where s.id::text = (storage.foldername(objects.name))[1] and c.teacher_id = auth.uid()));
