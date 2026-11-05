create table public.meal_templates (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  revision bigint not null check (revision > 0),
  template jsonb not null check (jsonb_typeof(template) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meal_templates_template_identity check (
    template ->> 'id' = id::text
    and template ->> 'name' = name
    and template ->> 'revision' = revision::text
  ),
  constraint meal_templates_owner_id_unique unique (user_id, id)
);
create index meal_templates_user_updated_idx on public.meal_templates(user_id, updated_at desc);
alter table public.meal_templates enable row level security;
revoke all on public.meal_templates from public, anon, authenticated;
grant select, insert, update, delete on public.meal_templates to service_role;
