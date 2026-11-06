-- A server-confirmed void advances the day revision and removes its logical meal draft.
-- Stale offline copies then conflict and reload the server tombstone instead of restoring the meal.
create or replace function public.append_journal_snapshot(p_user_id uuid, p_day_id uuid, p_expected_day_revision bigint,
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
    if next_revision <> current_day.revision + 1 then
      raise exception using errcode = '40001', message = 'JOURNAL_REVISION_CONFLICT';
    end if;
    select count(*) into target_meal_count
      from jsonb_array_elements(p_expected_draft -> 'meals') as meals(meal)
      where meals.meal ->> 'id' = v_logical_id;
    if target_meal_count > 1 then
      raise exception using errcode = '22023', message = 'JOURNAL_DRAFT_INVALID';
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
  update public.journal_days d set revision = next_revision, local_date = (p_next_draft ->> 'localDate')::date,
    time_zone = p_next_draft ->> 'timeZone', draft = p_next_draft, updated_at = now() where d.id = p_day_id and d.user_id = p_user_id;
  select s.* into saved from public.journal_meal_snapshots s where s.snapshot_id = v_snapshot_id and s.user_id = p_user_id;
  return next saved;
end
$function$;
revoke all on function public.append_journal_snapshot(uuid,uuid,bigint,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.append_journal_snapshot(uuid,uuid,bigint,jsonb,jsonb,jsonb) to service_role;
