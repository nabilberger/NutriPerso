-- Assign existing personal recipe data to its original Auth owner, then scope all recipe operations.
-- Apply this before inviting additional users. If legacy rows exist and Auth has multiple users,
-- stop and set the proven legacy owner explicitly rather than assigning rows ambiguously.

alter table public.recipes add column user_id uuid references auth.users(id) on delete restrict;
alter table public.recipe_snapshots add column user_id uuid references auth.users(id) on delete restrict;

do $migration$
declare
  auth_user_count bigint;
  legacy_owner uuid;
  has_legacy_rows boolean;
begin
  select exists (select 1 from public.recipes) into has_legacy_rows;
  select count(*) into auth_user_count from auth.users;
  if has_legacy_rows then
    if auth_user_count <> 1 then
      raise exception 'Recipe ownership backfill requires exactly one existing Auth user; found %. Set the legacy owner explicitly before applying.', auth_user_count;
    end if;
    select u.id into legacy_owner from auth.users u;
    update public.recipes r set user_id = legacy_owner where r.user_id is null;
  end if;
  update public.recipe_snapshots s
    set user_id = r.user_id
    from public.recipes r
    where r.id = s.recipe_id and s.user_id is null;
  if exists (select 1 from public.recipes where user_id is null)
    or exists (select 1 from public.recipe_snapshots where user_id is null) then
    raise exception 'Recipe ownership backfill left unowned rows; migration stopped.';
  end if;
end
$migration$;

alter table public.recipes alter column user_id set not null;
alter table public.recipe_snapshots alter column user_id set not null;
alter table public.recipes add constraint recipes_user_id_id_unique unique (user_id, id);
alter table public.recipe_snapshots
  drop constraint recipe_snapshots_recipe_id_fkey,
  drop constraint recipe_snapshots_self_fk,
  drop constraint recipe_snapshots_recipe_revision_unique;
alter table public.recipe_snapshots
  add constraint recipe_snapshots_recipe_revision_unique unique (user_id, recipe_id, recipe_revision),
  add constraint recipe_snapshots_owner_pair_unique unique (user_id, recipe_id, snapshot_id);
alter table public.recipe_snapshots
  add constraint recipe_snapshots_recipe_owner_fk foreign key (user_id, recipe_id)
    references public.recipes(user_id, id) on delete restrict,
  add constraint recipe_snapshots_self_fk foreign key (user_id, recipe_id, predecessor_snapshot_id)
    references public.recipe_snapshots(user_id, recipe_id, snapshot_id) on delete restrict;

drop index public.recipe_snapshots_one_root_idx;
drop index public.recipe_snapshots_one_successor_idx;
create unique index recipe_snapshots_one_root_idx on public.recipe_snapshots(user_id, recipe_id)
  where predecessor_snapshot_id is null;
create unique index recipe_snapshots_one_successor_idx on public.recipe_snapshots(user_id, recipe_id, predecessor_snapshot_id)
  where predecessor_snapshot_id is not null;
create index recipes_user_updated_at_idx on public.recipes(user_id, updated_at desc);
create index recipe_snapshots_user_recipe_revision_idx on public.recipe_snapshots(user_id, recipe_id, recipe_revision);

create policy recipes_owner_select on public.recipes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy recipes_owner_write on public.recipes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy recipe_snapshots_owner_select on public.recipe_snapshots for select to authenticated
  using ((select auth.uid()) = user_id);
create policy recipe_snapshots_owner_insert on public.recipe_snapshots for insert to authenticated
  with check ((select auth.uid()) = user_id);

create or replace function private.guard_recipe_snapshot_insert()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare
  current_recipe public.recipes%rowtype;
  predecessor_revision bigint;
begin
  select r.* into current_recipe from public.recipes r
    where r.id = new.recipe_id and r.user_id = new.user_id for update;
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
    or coalesce((select jsonb_agg(jsonb_build_object(
        'id', item ->> 'ingredientId', 'foodId', item #>> '{food,foodId}',
        'quantity', item -> 'enteredQuantity', 'position', (ordinality - 1)::integer
      ) order by ordinality)
      from jsonb_array_elements(new.snapshot -> 'ingredients') with ordinality as snapshot_items(item, ordinality)), '[]'::jsonb)
      is distinct from current_recipe.draft -> 'ingredients' then
    raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
  end if;
  if new.predecessor_snapshot_id is null then
    if exists (select 1 from public.recipe_snapshots s where s.user_id = new.user_id and s.recipe_id = new.recipe_id) then
      raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
    end if;
  else
    select s.recipe_revision into predecessor_revision from public.recipe_snapshots s
      where s.user_id = new.user_id and s.recipe_id = new.recipe_id and s.snapshot_id = new.predecessor_snapshot_id;
    if not found or predecessor_revision + 1 <> new.recipe_revision then
      raise exception using errcode = '40001', message = 'RECIPE_SNAPSHOT_CHAIN_INVALID';
    end if;
  end if;
  return new;
end
$function$;

drop function public.save_recipe_draft(uuid, bigint, jsonb);
create function public.save_recipe_draft(p_user_id uuid, p_recipe_id uuid, p_expected_revision bigint, p_draft jsonb)
returns setof public.recipes language plpgsql security invoker set search_path = '' as $function$
declare current_recipe public.recipes%rowtype; next_revision bigint; recipe_name text;
begin
  if p_user_id is null or p_recipe_id is null or p_expected_revision is null or p_expected_revision < 0
    or jsonb_typeof(p_draft) is distinct from 'object'
    or p_draft ->> 'id' is distinct from p_recipe_id::text
    or jsonb_typeof(p_draft -> 'ingredients') is distinct from 'array'
    or coalesce(p_draft ->> 'revision', '') !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'RECIPE_DRAFT_INVALID';
  end if;
  next_revision := (p_draft ->> 'revision')::bigint;
  recipe_name := btrim(p_draft ->> 'name');
  if recipe_name is null or recipe_name = '' then raise exception using errcode = '22023', message = 'RECIPE_DRAFT_INVALID'; end if;
  select r.* into current_recipe from public.recipes r where r.id = p_recipe_id and r.user_id = p_user_id for update;
  if not found then
    if exists (select 1 from public.recipes r where r.id = p_recipe_id) then
      raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
    end if;
    if p_expected_revision <> 0 or next_revision <> 1 then
      raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
    end if;
    insert into public.recipes(id, user_id, name, revision, draft)
      values (p_recipe_id, p_user_id, recipe_name, next_revision, p_draft)
      on conflict (id) do nothing returning * into current_recipe;
    if found then return next current_recipe; return; end if;
    select r.* into current_recipe from public.recipes r where r.id = p_recipe_id and r.user_id = p_user_id for update;
    if not found then raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT'; end if;
  end if;
  if current_recipe.revision = p_expected_revision + 1 and current_recipe.revision = next_revision and current_recipe.draft = p_draft then
    return next current_recipe; return;
  end if;
  if current_recipe.revision <> p_expected_revision or next_revision <> p_expected_revision + 1 then
    raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
  end if;
  update public.recipes r set name = recipe_name, revision = next_revision, draft = p_draft, updated_at = now()
    where r.id = p_recipe_id and r.user_id = p_user_id returning r.* into current_recipe;
  return next current_recipe;
end
$function$;

drop function public.append_recipe_snapshot(uuid, bigint, text, jsonb);
create function public.append_recipe_snapshot(p_user_id uuid, p_recipe_id uuid, p_expected_revision bigint,
  p_expected_predecessor_snapshot_id text, p_snapshot jsonb)
returns setof public.recipe_snapshots language plpgsql security invoker set search_path = '' as $function$
declare current_recipe public.recipes%rowtype; current_head text; snapshot_revision bigint;
  saved_snapshot public.recipe_snapshots%rowtype; existing_snapshot public.recipe_snapshots%rowtype; recipe_found boolean;
begin
  if p_user_id is null then raise exception using errcode = '22023', message = 'RECIPE_USER_REQUIRED'; end if;
  select r.* into current_recipe from public.recipes r where r.id = p_recipe_id and r.user_id = p_user_id for update;
  recipe_found := found;
  if p_snapshot ->> 'snapshotId' is not null then
    select s.* into existing_snapshot from public.recipe_snapshots s where s.snapshot_id = p_snapshot ->> 'snapshotId';
    if found then
      if existing_snapshot.user_id = p_user_id and existing_snapshot.recipe_id = p_recipe_id
        and existing_snapshot.snapshot = p_snapshot
        and existing_snapshot.predecessor_snapshot_id is not distinct from p_expected_predecessor_snapshot_id then
        return next existing_snapshot; return;
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
    or p_snapshot ->> 'snapshotId' is null or p_snapshot ->> 'engineVersion' is null
    or p_snapshot ->> 'confirmedAt' is null or jsonb_typeof(p_snapshot -> 'ingredients') is distinct from 'array'
    or jsonb_typeof(p_snapshot -> 'referenceTotals') is distinct from 'array'
    or jsonb_typeof(p_snapshot -> 'totals') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'RECIPE_SNAPSHOT_INVALID';
  end if;
  snapshot_revision := (p_snapshot #>> '{recipe,revision}')::bigint;
  if snapshot_revision <> p_expected_revision then raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT'; end if;
  select s.snapshot_id into current_head from public.recipe_snapshots s
    where s.user_id = p_user_id and s.recipe_id = p_recipe_id
      and not exists (select 1 from public.recipe_snapshots child where child.user_id = s.user_id
        and child.recipe_id = s.recipe_id and child.predecessor_snapshot_id = s.snapshot_id);
  if current_head is distinct from p_expected_predecessor_snapshot_id then
    raise exception using errcode = '40001', message = 'RECIPE_REVISION_CONFLICT';
  end if;
  insert into public.recipe_snapshots(snapshot_id, user_id, recipe_id, recipe_revision, predecessor_snapshot_id, engine_version, confirmed_at, snapshot)
    values (p_snapshot ->> 'snapshotId', p_user_id, p_recipe_id, snapshot_revision, p_expected_predecessor_snapshot_id,
      p_snapshot ->> 'engineVersion', (p_snapshot ->> 'confirmedAt')::timestamptz, p_snapshot)
    returning * into saved_snapshot;
  return next saved_snapshot;
end
$function$;

revoke all on function public.save_recipe_draft(uuid, uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.append_recipe_snapshot(uuid, uuid, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_recipe_draft(uuid, uuid, bigint, jsonb) to service_role;
grant execute on function public.append_recipe_snapshot(uuid, uuid, bigint, text, jsonb) to service_role;
