alter table public.user_profiles
  add column if not exists preferred_language text not null default 'en';

alter table public.user_profiles
  drop constraint if exists user_profiles_preferred_language_check;

alter table public.user_profiles
  add constraint user_profiles_preferred_language_check
  check (preferred_language in ('en', 'ny', 'sw', 'fr', 'pt'));

comment on column public.user_profiles.preferred_language is
  'Preferred UI language for react-i18next. Supported: en, ny, sw, fr, pt.';
