-- Mutable day drafts plus append-only, autonomous meal snapshots.

create table public.journal_days (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  local_date date not null,
  time_zone text not null check (btrim(time_zone) <> ''),
  revision bigint not null check (revision > 0),
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journal_days_draft_identity check (
    draft ->> 'id' = id::text
    and draft ->> 'localDate' = local_date::text
    and draft ->> 'timeZone' = time_zone
    and draft ->> 'revision' = revision::text
    and jsonb_typeof(draft -> 'meals') = 'array'
  ),
  constraint journal_days_user_id_unique unique (user_id, id)
);
create index journal_days_local_date_idx on public.journal_days(local_date desc);
create index journal_days_updated_at_idx on public.journal_days(updated_at desc);

create table public.journal_meal_snapshots (
  snapshot_id text not null check (btrim(snapshot_id) <> ''),
  logical_meal_id text not null check (btrim(logical_meal_id) <> ''),
  user_id uuid not null references auth.users(id) on delete restrict,
  day_id uuid not null,
  revision bigint not null check (revision > 0),
  predecessor_snapshot_id text,
  status text not null check (status in ('confirmed', 'void')),
  local_date date not null,
  time_zone text not null check (btrim(time_zone) <> ''),
  confirmed_at timestamptz not null,
  engine_version text not null check (btrim(engine_version) <> ''),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  constraint journal_snapshot_owner_pair_unique unique (user_id, logical_meal_id, snapshot_id),
  constraint journal_snapshot_owner_day_pair_unique unique (user_id, logical_meal_id, day_id, snapshot_id),
  constraint journal_snapshot_day_owner_fk foreign key (user_id, day_id)
    references public.journal_days(user_id, id) on delete restrict,
  constraint journal_snapshot_self_fk foreign key (user_id, logical_meal_id, day_id, predecessor_snapshot_id)
    references public.journal_meal_snapshots(user_id, logical_meal_id, day_id, snapshot_id) on delete restrict,
  constraint journal_snapshot_identity check (
    snapshot ->> 'snapshotId' = snapshot_id
    and snapshot ->> 'logicalMealId' = logical_meal_id
    and snapshot ->> 'dayId' = day_id::text
    and snapshot ->> 'revision' = revision::text
    and snapshot ->> 'status' = status
    and snapshot ->> 'localDate' = local_date::text
    and snapshot ->> 'timeZone' = time_zone
    and snapshot ->> 'engineVersion' = engine_version
    and (snapshot ->> 'confirmedAt')::timestamptz = confirmed_at
    and snapshot ->> 'supersedesSnapshotId' is not distinct from predecessor_snapshot_id
    and jsonb_typeof(snapshot -> 'items') = 'array'
    and ((status = 'confirmed' and jsonb_typeof(snapshot -> 'totals') = 'object')
      or (status = 'void' and jsonb_typeof(snapshot -> 'totals') = 'array' and snapshot -> 'totals' = '[]'::jsonb))
  ),
  constraint journal_snapshot_pk primary key (user_id, snapshot_id),
  constraint journal_snapshot_revision_unique unique (user_id, logical_meal_id, revision)
);
create unique index journal_snapshot_one_root_idx on public.journal_meal_snapshots(user_id, logical_meal_id)
  where predecessor_snapshot_id is null;
create unique index journal_snapshot_one_successor_idx on public.journal_meal_snapshots(user_id, logical_meal_id, predecessor_snapshot_id)
  where predecessor_snapshot_id is not null;
create index journal_snapshot_day_idx on public.journal_meal_snapshots(local_date, day_id);
create index journal_snapshot_status_idx on public.journal_meal_snapshots(status, local_date);

alter table public.journal_days enable row level security;
alter table public.journal_meal_snapshots enable row level security;
create policy journal_days_owner_select on public.journal_days for select to authenticated
  using ((select auth.uid()) = user_id);
create policy journal_days_owner_write on public.journal_days for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy journal_snapshots_owner_select on public.journal_meal_snapshots for select to authenticated
  using ((select auth.uid()) = user_id);
create policy journal_snapshots_owner_insert on public.journal_meal_snapshots for insert to authenticated
  with check ((select auth.uid()) = user_id);
revoke all on table public.journal_days, public.journal_meal_snapshots from public, anon, authenticated;
grant select, insert, update on public.journal_days to service_role;
grant select, insert on public.journal_meal_snapshots to service_role;

create function private.guard_journal_snapshot_insert()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare
  predecessor_revision bigint;
  predecessor_day_id uuid;
  day_row public.journal_days%rowtype;
  snapshot_meal jsonb;
begin
  select d.* into day_row from public.journal_days d where d.id = new.day_id and d.user_id = new.user_id for update;
  if not found then raise exception using errcode = '22023', message = 'JOURNAL_DAY_NOT_FOUND'; end if;
  if new.predecessor_snapshot_id is null then
    if new.revision <> 1 or exists (select 1 from public.journal_meal_snapshots s where s.user_id = new.user_id and s.logical_meal_id = new.logical_meal_id) then
      raise exception using errcode = '40001', message = 'JOURNAL_REVISION_CONFLICT';
    end if;
  else
    select s.revision, s.day_id into predecessor_revision, predecessor_day_id from public.journal_meal_snapshots s
      where s.user_id = new.user_id and s.logical_meal_id = new.logical_meal_id and s.snapshot_id = new.predecessor_snapshot_id;
    if not found or predecessor_day_id <> new.day_id then
      raise exception using errcode = '40001', message = 'JOURNAL_HISTORY_DAY_MISMATCH';
    end if;
    if new.revision <> predecessor_revision + 1 then
      raise exception using errcode = '40001', message = 'JOURNAL_HISTORY_CONFLICT';
    end if;
  end if;
  if new.status = 'confirmed' then
    select meals.meal into snapshot_meal from jsonb_array_elements(day_row.draft -> 'meals') as meals(meal)
      where meals.meal ->> 'id' = new.logical_meal_id;
    if snapshot_meal is null
      or (snapshot_meal ->> 'revision')::bigint <> (new.snapshot ->> 'mealRevision')::bigint
      or (new.snapshot ->> 'dayRevision')::bigint <> day_row.revision
      or new.snapshot ->> 'localDate' <> day_row.local_date::text
      or new.snapshot ->> 'timeZone' <> day_row.time_zone
      or new.snapshot ->> 'mealKind' is distinct from snapshot_meal ->> 'kind'
      or new.snapshot -> 'label' is distinct from snapshot_meal -> 'label'
      or new.snapshot -> 'occurredAt' is distinct from snapshot_meal -> 'occurredAt'
      or new.snapshot -> 'sortOrder' is distinct from snapshot_meal -> 'sortOrder'
      or (
        select coalesce(jsonb_agg(case when item ->> 'kind' = 'food' then
          jsonb_build_object('kind', 'food', 'id', item ->> 'id', 'foodId', item ->> 'foodId', 'quantity', item -> 'enteredQuantity', 'sortOrder', item -> 'sortOrder')
          else jsonb_build_object('kind', 'recipe', 'id', item ->> 'id', 'recipeSnapshot', item -> 'recipeSnapshot', 'quantity', item -> 'quantity', 'sortOrder', item -> 'sortOrder') end order by ordinality), '[]'::jsonb)
        from jsonb_array_elements(new.snapshot -> 'items') with ordinality as s(item, ordinality)
      ) is distinct from (
        select coalesce(jsonb_agg(case when item ->> 'kind' = 'food' then
          jsonb_build_object('kind', 'food', 'id', item ->> 'id', 'foodId', item ->> 'foodId', 'quantity', item -> 'quantity', 'sortOrder', item -> 'sortOrder')
          else jsonb_build_object('kind', 'recipe', 'id', item ->> 'id', 'recipeSnapshot', item -> 'recipeSnapshot', 'quantity', item -> 'quantity', 'sortOrder', item -> 'sortOrder') end order by ordinality), '[]'::jsonb)
        from jsonb_array_elements(snapshot_meal -> 'items') with ordinality as d(item, ordinality)
      ) then
      raise exception using errcode = '40001', message = 'JOURNAL_DRAFT_SNAPSHOT_MISMATCH';
    end if;
  elsif new.status = 'void' and jsonb_array_length(new.snapshot -> 'items') <> 0 then
    raise exception using errcode = '22023', message = 'JOURNAL_VOID_INVALID';
  end if;
  return new;
end
$function$;

create function private.reject_journal_snapshot_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  raise exception using errcode = '55000', message = 'JOURNAL_SNAPSHOT_IMMUTABLE';
  return old;
end
$function$;
revoke all on function private.guard_journal_snapshot_insert() from public, anon, authenticated;
revoke all on function private.reject_journal_snapshot_mutation() from public, anon, authenticated;
grant execute on function private.guard_journal_snapshot_insert() to service_role;
grant execute on function private.reject_journal_snapshot_mutation() to service_role;
create trigger journal_snapshot_guard before insert on public.journal_meal_snapshots
  for each row execute function private.guard_journal_snapshot_insert();
create trigger journal_snapshot_immutable before update or delete on public.journal_meal_snapshots
  for each row execute function private.reject_journal_snapshot_mutation();

create function public.save_journal_day_draft(p_user_id uuid, p_day_id uuid, p_expected_revision bigint, p_draft jsonb)
returns setof public.journal_days language plpgsql security invoker set search_path = '' as $function$
declare current_day public.journal_days%rowtype; next_revision bigint;
begin
  if p_user_id is null or p_day_id is null or p_expected_revision is null or p_expected_revision < 0 or jsonb_typeof(p_draft) is distinct from 'object'
    or p_draft ->> 'id' is distinct from p_day_id::text
    or coalesce(p_draft ->> 'revision','') !~ '^[1-9][0-9]*$'
    or jsonb_typeof(p_draft -> 'meals') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'JOURNAL_DRAFT_INVALID';
  end if;
  next_revision := (p_draft ->> 'revision')::bigint;
  select d.* into current_day from public.journal_days d where d.id = p_day_id and d.user_id = p_user_id for update;
  if not found then
    if p_expected_revision <> 0 or next_revision <> 1 then raise exception using errcode = '40001', message = 'JOURNAL_REVISION_CONFLICT'; end if;
    insert into public.journal_days(id, user_id, local_date, time_zone, revision, draft)
      values (p_day_id, p_user_id, (p_draft ->> 'localDate')::date, p_draft ->> 'timeZone', next_revision, p_draft)
      on conflict(id) do nothing returning * into current_day;
    if found then return next current_day; return; end if;
    select d.* into current_day from public.journal_days d where d.id = p_day_id and d.user_id = p_user_id for update;
    if not found then raise exception using errcode = '40001', message = 'JOURNAL_REVISION_CONFLICT'; end if;
  end if;
  if current_day.revision = p_expected_revision + 1 and next_revision = current_day.revision and p_draft = current_day.draft then
    return next current_day; return;
  end if;
  if current_day.revision <> p_expected_revision or next_revision <> p_expected_revision + 1 then
    raise exception using errcode = '40001', message = 'JOURNAL_REVISION_CONFLICT';
  end if;
  update public.journal_days d set local_date = (p_draft ->> 'localDate')::date,
    time_zone = p_draft ->> 'timeZone', revision = next_revision, draft = p_draft, updated_at = now()
    where d.id = p_day_id and d.user_id = p_user_id returning d.* into current_day;
  return next current_day;
end
$function$;

create function public.append_journal_snapshot(p_user_id uuid, p_day_id uuid, p_expected_day_revision bigint,
  p_expected_draft jsonb, p_next_draft jsonb, p_snapshot jsonb)
returns setof public.journal_meal_snapshots language plpgsql security invoker set search_path = '' as $function$
declare current_day public.journal_days%rowtype; saved public.journal_meal_snapshots%rowtype;
  v_snapshot_id text; v_logical_id text; next_revision bigint; expected_next_draft jsonb; expected_meals jsonb;
  target_meal_count bigint;
begin
  v_snapshot_id := p_snapshot ->> 'snapshotId'; v_logical_id := p_snapshot ->> 'logicalMealId';
  if p_user_id is null then raise exception using errcode = '22023', message = 'JOURNAL_USER_REQUIRED'; end if;
  select s.* into saved from public.journal_meal_snapshots s where s.snapshot_id = v_snapshot_id and s.user_id = p_user_id;
  if found then
    if saved.snapshot = p_snapshot then return next saved; return; end if;
    raise exception using errcode = '40001', message = 'JOURNAL_SNAPSHOT_ID_CONFLICT';
  end if;
  select d.* into current_day from public.journal_days d where d.id = p_day_id and d.user_id = p_user_id for update;
  if not found or current_day.revision <> p_expected_day_revision or current_day.draft <> p_expected_draft then
    raise exception using errcode = '40001', message = 'JOURNAL_REVISION_CONFLICT';
  end if;
  if jsonb_typeof(p_next_draft) is distinct from 'object' or p_next_draft ->> 'id' is distinct from p_day_id::text then
    raise exception using errcode = '22023', message = 'JOURNAL_DRAFT_INVALID';
  end if;
  if jsonb_typeof(p_expected_draft) is distinct from 'object'
    or jsonb_typeof(p_expected_draft -> 'meals') is distinct from 'array'
    or coalesce(p_next_draft ->> 'revision', '') !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'JOURNAL_DRAFT_INVALID';
  end if;
  next_revision := (p_next_draft ->> 'revision')::bigint;
  if p_snapshot ->> 'status' = 'void' then
    if p_next_draft <> p_expected_draft or next_revision <> current_day.revision then
      raise exception using errcode = '22023', message = 'JOURNAL_VOID_INVALID';
    end if;
  elsif p_snapshot ->> 'status' = 'confirmed' then
    if next_revision <> current_day.revision + 1 then
      raise exception using errcode = '40001', message = 'JOURNAL_REVISION_CONFLICT';
    end if;
    select count(*) into target_meal_count
      from jsonb_array_elements(p_expected_draft -> 'meals') as meals(meal)
      where meals.meal ->> 'id' = v_logical_id;
    if target_meal_count <> 1 then
      raise exception using errcode = '40001', message = 'JOURNAL_DRAFT_SNAPSHOT_MISMATCH';
    end if;
    select coalesce(jsonb_agg(meals.meal order by meals.ordinality), '[]'::jsonb) into expected_meals
      from jsonb_array_elements(p_expected_draft -> 'meals') with ordinality as meals(meal, ordinality)
      where meals.meal ->> 'id' is distinct from v_logical_id;
    expected_next_draft := jsonb_set(
      jsonb_set(p_expected_draft, '{revision}', to_jsonb(next_revision), false),
      '{meals}', expected_meals, false
    );
    if p_next_draft is distinct from expected_next_draft
      or p_next_draft ->> 'localDate' is distinct from current_day.local_date::text
      or p_next_draft ->> 'timeZone' is distinct from current_day.time_zone then
      raise exception using errcode = '22023', message = 'JOURNAL_DRAFT_SNAPSHOT_MISMATCH';
    end if;
  else
    raise exception using errcode = '22023', message = 'JOURNAL_SNAPSHOT_INVALID';
  end if;
  insert into public.journal_meal_snapshots(snapshot_id, logical_meal_id, user_id, day_id, revision,
    predecessor_snapshot_id, status, local_date, time_zone, confirmed_at, engine_version, snapshot)
  values (v_snapshot_id, v_logical_id, p_user_id, p_day_id, (p_snapshot ->> 'revision')::bigint,
    nullif(p_snapshot ->> 'supersedesSnapshotId',''), p_snapshot ->> 'status',
    (p_snapshot ->> 'localDate')::date, p_snapshot ->> 'timeZone', (p_snapshot ->> 'confirmedAt')::timestamptz,
    p_snapshot ->> 'engineVersion', p_snapshot);
  if p_snapshot ->> 'status' <> 'void' then
    update public.journal_days d set revision = next_revision, local_date = (p_next_draft ->> 'localDate')::date,
      time_zone = p_next_draft ->> 'timeZone', draft = p_next_draft, updated_at = now() where d.id = p_day_id and d.user_id = p_user_id;
  end if;
  select s.* into saved from public.journal_meal_snapshots s where s.snapshot_id = v_snapshot_id and s.user_id = p_user_id;
  return next saved;
end
$function$;

revoke all on function public.save_journal_day_draft(uuid,uuid,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.append_journal_snapshot(uuid,uuid,bigint,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_journal_day_draft(uuid,uuid,bigint,jsonb) to service_role;
grant execute on function public.append_journal_snapshot(uuid,uuid,bigint,jsonb,jsonb,jsonb) to service_role;
