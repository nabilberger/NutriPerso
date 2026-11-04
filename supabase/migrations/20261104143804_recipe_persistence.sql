-- Mutable recipe drafts and append-only, autonomous confirmation snapshots.

create table public.recipes (
  id uuid primary key,
  name text not null check (btrim(name) <> ''),
  revision bigint not null check (revision > 0),
  draft jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipes_draft_object check (jsonb_typeof(draft) = 'object'),
  constraint recipes_draft_identity check (
    draft ->> 'id' is not null
    and draft ->> 'name' is not null
    and draft ->> 'revision' is not null
    and draft -> 'ingredients' is not null
    and draft ->> 'id' = id::text
    and draft ->> 'name' = name
    and draft ->> 'revision' = revision::text
    and jsonb_typeof(draft -> 'ingredients') = 'array'
  )
);

create index recipes_updated_at_idx on public.recipes (updated_at desc);

create table public.recipe_snapshots (
  snapshot_id text primary key check (btrim(snapshot_id) <> ''),
  recipe_id uuid not null references public.recipes(id) on delete restrict,
  recipe_revision bigint not null check (recipe_revision > 0),
  predecessor_snapshot_id text,
  engine_version text not null check (btrim(engine_version) <> ''),
  confirmed_at timestamptz not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint recipe_snapshots_self_fk
    foreign key (recipe_id, predecessor_snapshot_id)
    references public.recipe_snapshots(recipe_id, snapshot_id)
    on delete restrict,
  constraint recipe_snapshots_identity check (
    jsonb_typeof(snapshot) = 'object'
    and snapshot ->> 'schemaVersion' is not null
    and snapshot ->> 'snapshotId' is not null
    and snapshot ->> 'engineVersion' is not null
    and snapshot ->> 'confirmedAt' is not null
    and snapshot #>> '{recipe,id}' is not null
    and snapshot #>> '{recipe,revision}' is not null
    and snapshot -> 'ingredients' is not null
    and snapshot -> 'referenceTotals' is not null
    and snapshot -> 'totals' is not null
    and snapshot ->> 'schemaVersion' = '1'
    and snapshot ->> 'snapshotId' = snapshot_id
    and snapshot ->> 'engineVersion' = engine_version
    and (snapshot ->> 'confirmedAt')::timestamptz = confirmed_at
    and snapshot #>> '{recipe,id}' = recipe_id::text
    and snapshot #>> '{recipe,revision}' = recipe_revision::text
    and jsonb_typeof(snapshot -> 'ingredients') = 'array'
    and jsonb_typeof(snapshot -> 'referenceTotals') = 'array'
    and jsonb_typeof(snapshot -> 'totals') = 'array'
  ),
  constraint recipe_snapshots_recipe_revision_unique unique (recipe_id, recipe_revision),
  constraint recipe_snapshots_recipe_snapshot_unique unique (recipe_id, snapshot_id)
);

-- One root and at most one successor per snapshot form a linear history.
create unique index recipe_snapshots_one_root_idx
  on public.recipe_snapshots (recipe_id)
  where predecessor_snapshot_id is null;
create unique index recipe_snapshots_one_successor_idx
  on public.recipe_snapshots (recipe_id, predecessor_snapshot_id)
  where predecessor_snapshot_id is not null;

alter table public.recipes enable row level security;
alter table public.recipe_snapshots enable row level security;

revoke all on table public.recipes, public.recipe_snapshots from public, anon, authenticated;
grant select, insert, update on table public.recipes to service_role;
grant select, insert on table public.recipe_snapshots to service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create function private.guard_recipe_snapshot_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_recipe public.recipes%rowtype;
  predecessor_revision bigint;
begin
  select r.* into current_recipe
  from public.recipes as r
  where r.id = new.recipe_id
  for update;

  if not found or current_recipe.revision <> new.recipe_revision then
    raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
  end if;

  if new.snapshot_id is distinct from (new.snapshot ->> 'snapshotId')
    or new.recipe_id::text is distinct from (new.snapshot #>> '{recipe,id}')
    or new.recipe_revision::text is distinct from (new.snapshot #>> '{recipe,revision}')
    or new.engine_version is distinct from (new.snapshot ->> 'engineVersion')
    or (new.snapshot ->> 'confirmedAt')::timestamptz is distinct from new.confirmed_at then
    raise exception using errcode = '22023', message = 'RECIPE_SNAPSHOT_MISMATCH';
  end if;

  if current_recipe.draft ->> 'name' is distinct from new.snapshot #>> '{recipe,name}'
    or current_recipe.draft -> 'servings' is distinct from new.snapshot #> '{recipe,servings}'
    or current_recipe.draft -> 'finalWeight' is distinct from new.snapshot #> '{recipe,finalWeight}'
    or coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item ->> 'ingredientId',
        'foodId', item #>> '{food,foodId}',
        'quantity', item -> 'enteredQuantity',
        'position', (ordinality - 1)::integer
      ) order by ordinality)
      from jsonb_array_elements(new.snapshot -> 'ingredients') with ordinality as snapshot_items(item, ordinality)
    ), '[]'::jsonb) is distinct from current_recipe.draft -> 'ingredients' then
    raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
  end if;

  if new.predecessor_snapshot_id is null then
    if exists (select 1 from public.recipe_snapshots as s where s.recipe_id = new.recipe_id) then
      raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
    end if;
  else
    select s.recipe_revision into predecessor_revision
    from public.recipe_snapshots as s
    where s.recipe_id = new.recipe_id
      and s.snapshot_id = new.predecessor_snapshot_id;
    if not found or predecessor_revision >= new.recipe_revision then
      raise exception using errcode = '22023', message = 'RECIPE_SNAPSHOT_CHAIN_INVALID';
    end if;
  end if;

  return new;
end
$function$;

create function private.reject_recipe_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'RECIPE_SNAPSHOT_IMMUTABLE';
  return old;
end
$function$;

revoke all on function private.guard_recipe_snapshot_insert() from public, anon, authenticated;
revoke all on function private.reject_recipe_snapshot_mutation() from public, anon, authenticated;
grant execute on function private.guard_recipe_snapshot_insert() to service_role;
grant execute on function private.reject_recipe_snapshot_mutation() to service_role;

create trigger recipe_snapshots_guard_insert
  before insert on public.recipe_snapshots
  for each row execute function private.guard_recipe_snapshot_insert();
create trigger recipe_snapshots_immutable
  before update or delete on public.recipe_snapshots
  for each row execute function private.reject_recipe_snapshot_mutation();

create function public.save_recipe_draft(
  p_recipe_id uuid,
  p_expected_revision bigint,
  p_draft jsonb
)
returns setof public.recipes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_recipe public.recipes%rowtype;
  next_revision bigint;
  recipe_name text;
begin
  if p_recipe_id is null or p_expected_revision is null or p_expected_revision < 0
    or jsonb_typeof(p_draft) is distinct from 'object'
    or p_draft ->> 'id' is distinct from p_recipe_id::text
    or jsonb_typeof(p_draft -> 'ingredients') is distinct from 'array'
    or coalesce(p_draft ->> 'revision', '') !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'RECIPE_DRAFT_INVALID';
  end if;

  next_revision := (p_draft ->> 'revision')::bigint;
  recipe_name := btrim(p_draft ->> 'name');
  if recipe_name is null or recipe_name = '' then
    raise exception using errcode = '22023', message = 'RECIPE_DRAFT_INVALID';
  end if;

  select r.* into current_recipe
  from public.recipes as r
  where r.id = p_recipe_id
  for update;

  if not found then
    if p_expected_revision <> 0 or next_revision <> 1 then
      raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
    end if;
    insert into public.recipes (id, name, revision, draft)
    values (p_recipe_id, recipe_name, next_revision, p_draft)
    on conflict (id) do nothing
    returning * into current_recipe;
    if found then
      return next current_recipe;
      return;
    end if;
    select r.* into current_recipe
    from public.recipes as r
    where r.id = p_recipe_id
    for update;
  end if;

  -- A retry of the same command returns its existing result.
  if current_recipe.revision = p_expected_revision + 1
    and current_recipe.revision = next_revision
    and current_recipe.draft = p_draft then
    return next current_recipe;
    return;
  end if;

  if current_recipe.revision <> p_expected_revision or next_revision <> p_expected_revision + 1 then
    raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
  end if;

  update public.recipes as r
  set name = recipe_name,
      revision = next_revision,
      draft = p_draft,
      updated_at = now()
  where r.id = p_recipe_id
  returning r.* into current_recipe;
  return next current_recipe;
end
$function$;

create function public.append_recipe_snapshot(
  p_recipe_id uuid,
  p_expected_revision bigint,
  p_expected_predecessor_snapshot_id text,
  p_snapshot jsonb
)
returns setof public.recipe_snapshots
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_recipe public.recipes%rowtype;
  current_head text;
  snapshot_revision bigint;
  saved_snapshot public.recipe_snapshots%rowtype;
  existing_snapshot public.recipe_snapshots%rowtype;
  recipe_found boolean;
begin
  select r.* into current_recipe
  from public.recipes as r
  where r.id = p_recipe_id
  for update;
  recipe_found := found;

  if p_snapshot ->> 'snapshotId' is not null then
    select s.* into existing_snapshot
    from public.recipe_snapshots as s
    where s.snapshot_id = p_snapshot ->> 'snapshotId';
    if found then
      if existing_snapshot.recipe_id = p_recipe_id
        and existing_snapshot.snapshot = p_snapshot
        and existing_snapshot.predecessor_snapshot_id is not distinct from p_expected_predecessor_snapshot_id then
        return next existing_snapshot;
        return;
      end if;
      raise exception using errcode = '40001', message = 'RECIPE_SNAPSHOT_ID_CONFLICT';
    end if;
  end if;

  if not recipe_found or p_expected_revision is null or current_recipe.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
  end if;

  if jsonb_typeof(p_snapshot) is distinct from 'object'
    or p_snapshot ->> 'schemaVersion' is distinct from '1'
    or p_snapshot #>> '{recipe,id}' is distinct from p_recipe_id::text
    or coalesce(p_snapshot #>> '{recipe,revision}', '') !~ '^[1-9][0-9]*$'
    or p_snapshot ->> 'snapshotId' is null
    or p_snapshot ->> 'engineVersion' is null
    or p_snapshot ->> 'confirmedAt' is null
    or jsonb_typeof(p_snapshot -> 'ingredients') is distinct from 'array'
    or jsonb_typeof(p_snapshot -> 'referenceTotals') is distinct from 'array'
    or jsonb_typeof(p_snapshot -> 'totals') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'RECIPE_SNAPSHOT_INVALID';
  end if;

  snapshot_revision := (p_snapshot #>> '{recipe,revision}')::bigint;
  if snapshot_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
  end if;

  select s.snapshot_id into current_head
  from public.recipe_snapshots as s
  where s.recipe_id = p_recipe_id
    and not exists (
      select 1 from public.recipe_snapshots as child
      where child.recipe_id = s.recipe_id
        and child.predecessor_snapshot_id = s.snapshot_id
    );

  if current_head is distinct from p_expected_predecessor_snapshot_id then
    raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
  end if;

  insert into public.recipe_snapshots (
    snapshot_id, recipe_id, recipe_revision, predecessor_snapshot_id,
    engine_version, confirmed_at, snapshot
  ) values (
    p_snapshot ->> 'snapshotId', p_recipe_id, snapshot_revision,
    p_expected_predecessor_snapshot_id, p_snapshot ->> 'engineVersion',
    (p_snapshot ->> 'confirmedAt')::timestamptz, p_snapshot
  ) returning * into saved_snapshot;

  return next saved_snapshot;
end
$function$;

revoke all on function public.save_recipe_draft(uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.append_recipe_snapshot(uuid, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_recipe_draft(uuid, bigint, jsonb) to service_role;
grant execute on function public.append_recipe_snapshot(uuid, bigint, text, jsonb) to service_role;
