-- DISPOSABLE TEST PLATFORM ONLY. Not a product migration or deployed ACL model.
-- Based on tests/database/rls_security.test.js, without public grant-all defaults.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator nologin;
grant anon, authenticated, service_role to authenticator;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
 select current_setting('request.jwt.claim.role', true) $$;
grant usage on schema auth, public to anon, authenticated, service_role;
-- Do NOT grant application roles SELECT on auth.users or public table defaults.
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
 select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
grant usage on schema storage to anon, authenticated, service_role;
-- Minimal platform object API privileges, not public application-table grants.
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.objects to anon;
create schema extensions;
create extension pgcrypto with schema extensions;
create extension pg_trgm;
-- No scheduler or network execution: platform contracts intentionally unavailable.
create schema cron;
create table cron.job(jobid bigint generated always as identity primary key, jobname text unique, schedule text, command text, active boolean default true);
create function cron.schedule(name text, schedule text, command text) returns bigint language plpgsql as $$
 declare v bigint; begin
 insert into cron.job(jobname,schedule,command) values(name,schedule,command)
 on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid into v;
 return v; end $$;
create schema net;
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000)
 returns bigint language plpgsql as $$ begin raise exception 'R13 platform network disabled'; end $$;
