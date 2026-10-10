-- Visitors who are not signed in should have no direct table access at all (defence in depth; RLS already blocks them).
revoke all on all tables in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
