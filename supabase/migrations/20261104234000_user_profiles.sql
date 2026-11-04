-- One personal profile per authenticated user. Settings remain separate from Auth credentials.
create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  avatar_data_url text check (avatar_data_url is null or (char_length(avatar_data_url) <= 90000 and avatar_data_url ~ '^data:image/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$')),
  height_cm numeric(6,1) check (height_cm between 80 and 250),
  target_weight_kg numeric(6,1) check (target_weight_kg between 25 and 350),
  goal text not null default 'maintain' check (goal in ('maintain','lose','gain')),
  dietary_pattern text not null default 'mediterranean' check (dietary_pattern in ('mediterranean','vegetarian','vegan','other')),
  meals_per_day smallint not null default 2 check (meals_per_day between 1 and 6),
  fasting_enabled boolean not null default false,
  fasting_start time without time zone,
  fasting_end time without time zone,
  avoid_added_salt boolean not null default false,
  avoid_added_sugar boolean not null default false,
  notes text not null default '' check (char_length(notes) <= 1200),
  time_zone text not null default 'Africa/Casablanca' check (char_length(time_zone) between 3 and 80),
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
create policy user_profiles_select on public.user_profiles for select to authenticated using ((select auth.uid())=user_id);
create policy user_profiles_insert on public.user_profiles for insert to authenticated with check ((select auth.uid())=user_id);
create policy user_profiles_update on public.user_profiles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.user_profiles from public, anon;
grant select, insert, update on public.user_profiles to service_role;
