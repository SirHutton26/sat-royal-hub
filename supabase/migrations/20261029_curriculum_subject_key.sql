-- Curriculum rows are found by subject_key, the same short name the scheme of learning uses ('computing', 'maths', 'rme' ...),
-- so "RME", "Religious & Moral Education" and "R.M.E." all reach the same curriculum. Safe to run more than once.
alter table public.curriculum_items add column if not exists subject_key text;

update public.curriculum_items set subject_key = case
  when lower(subject) ~ '(computing|ict|computer)' then 'computing'
  when lower(subject) ~ '(career|ctech|technology)' then 'career technology'
  when lower(subject) ~ 'english' then 'english'
  when lower(subject) ~ 'math' then 'maths'
  when lower(subject) ~ '(relig|rme)' then 'rme'
  when lower(subject) ~ 'social' then 'social studies'
  when lower(subject) ~ 'science' then 'science'
  when lower(subject) ~ '(creative|arts)' then 'creative arts'
  when lower(subject) ~ '(ghanaian|dangme|twi|ewe|fante|akan)' then 'ghanaian language'
  when lower(subject) ~ 'french' then 'french'
  when lower(subject) ~ 'histor' then 'history'
  else lower(subject) end
where subject_key is null;

create index if not exists curriculum_items_key_idx on public.curriculum_items (lower(class_name), subject_key, sort_order);
