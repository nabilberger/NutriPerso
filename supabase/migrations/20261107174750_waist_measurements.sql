create table public.waist_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_on date not null,
  waist_cm numeric(4,1) not null check (waist_cm between 30 and 300),
  created_at timestamptz not null default now()
);
create index waist_measurements_owner_date_idx
  on public.waist_measurements (user_id, measured_on desc, created_at desc);
alter table public.waist_measurements enable row level security;
revoke all on public.waist_measurements from public, anon, authenticated, service_role;
grant select, insert, delete on public.waist_measurements to service_role;
