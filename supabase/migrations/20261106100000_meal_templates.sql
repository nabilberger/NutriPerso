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

create table public.meal_template_revisions (
  template_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  template jsonb not null check (jsonb_typeof(template) = 'object'),
  created_at timestamptz not null default now(),
  primary key (template_id, revision)
);
alter table public.meal_template_revisions enable row level security;
revoke all on public.meal_template_revisions from public, anon, authenticated;
grant select, insert on public.meal_template_revisions to service_role;

create or replace function public.save_meal_template_atomic(
  p_user_id uuid, p_template_id uuid, p_name text, p_revision bigint,
  p_template jsonb, p_expected_revision bigint
) returns setof public.meal_templates
language plpgsql security definer set search_path = ''
as $function$
declare saved public.meal_templates;
begin
  if p_user_id is null or p_template_id is null or p_revision < 1
    or char_length(btrim(p_name)) not between 1 and 80
    or jsonb_typeof(p_template) <> 'object'
    or p_template->>'id' <> p_template_id::text
    or p_template->>'name' <> btrim(p_name)
    or p_template->>'revision' <> p_revision::text then
    raise exception using errcode = '22023', message = 'invalid meal template';
  end if;

  if p_expected_revision is null then
    if p_revision <> 1 then raise exception using errcode = '40001', message = 'revision conflict'; end if;
    insert into public.meal_templates(id,user_id,name,revision,template)
      values(p_template_id,p_user_id,btrim(p_name),p_revision,p_template)
      returning * into saved;
  else
    update public.meal_templates set name=btrim(p_name), revision=p_revision, template=p_template, updated_at=now()
      where id=p_template_id and user_id=p_user_id and revision=p_expected_revision and p_revision=p_expected_revision+1
      returning * into saved;
    if not found then raise exception using errcode = '40001', message = 'revision conflict'; end if;
  end if;

  insert into public.meal_template_revisions(template_id,user_id,revision,template)
    values(saved.id,saved.user_id,saved.revision,saved.template);
  return next saved;
end
$function$;

revoke all on function public.save_meal_template_atomic(uuid,uuid,text,bigint,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.save_meal_template_atomic(uuid,uuid,text,bigint,jsonb,bigint) to service_role;
