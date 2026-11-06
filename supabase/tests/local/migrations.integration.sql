\echo 'Checking all seven migrations: schema, RLS, RPC permissions, and journal tombstones'
BEGIN;
DO $test$
DECLARE
  table_name text;
  signature text;
  function_id regprocedure;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'foods', 'food_nutrients', 'recipes', 'recipe_snapshots', 'journal_days',
    'journal_meal_snapshots', 'user_profiles', 'body_measurements',
    'meal_templates', 'meal_template_revisions'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relkind = 'r' AND c.relrowsecurity
    ) THEN RAISE EXCEPTION 'Missing table or disabled RLS: %', table_name; END IF;
    IF has_table_privilege('anon', 'public.' || table_name, 'SELECT,INSERT,UPDATE,DELETE')
      OR has_table_privilege('authenticated', 'public.' || table_name, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Unexpected direct client table privilege: %', table_name;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || table_name, 'SELECT')
      OR NOT has_table_privilege('service_role', 'public.' || table_name, 'INSERT') THEN
      RAISE EXCEPTION 'Worker service role lacks required table privileges: %', table_name;
    END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
    'public.save_recipe_draft(uuid,uuid,bigint,jsonb)',
    'public.append_recipe_snapshot(uuid,uuid,bigint,text,jsonb)',
    'public.save_journal_day_draft(uuid,uuid,bigint,jsonb)',
    'public.append_journal_snapshot(uuid,uuid,bigint,jsonb,jsonb,jsonb)',
    'public.save_meal_template_atomic(uuid,uuid,text,bigint,jsonb,bigint)'
  ] LOOP
    function_id := to_regprocedure(signature);
    IF function_id IS NULL THEN RAISE EXCEPTION 'Missing RPC: %', signature; END IF;
    IF has_function_privilege('anon', function_id, 'EXECUTE')
      OR has_function_privilege('authenticated', function_id, 'EXECUTE')
      OR NOT has_function_privilege('service_role', function_id, 'EXECUTE') THEN
      RAISE EXCEPTION 'Invalid RPC execute permissions: %', signature;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = function_id
      AND prosecdef IS DISTINCT FROM (signature = 'public.save_meal_template_atomic(uuid,uuid,text,bigint,jsonb,bigint)')) THEN
      RAISE EXCEPTION 'RPC security mode differs from its migration: %', signature;
    END IF;
  END LOOP;
  IF to_regprocedure('public.save_recipe_draft(uuid,bigint,jsonb)') IS NOT NULL
    OR to_regprocedure('public.append_recipe_snapshot(uuid,bigint,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy unscoped recipe RPC remains callable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='journal_days' AND policyname='journal_days_owner_select')
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='recipes' AND policyname='recipes_owner_select') THEN
    RAISE EXCEPTION 'Expected ownership policies are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='journal_snapshot_immutable' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='recipe_snapshots_immutable' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Expected snapshot immutability triggers are missing';
  END IF;
  RAISE NOTICE 'PASS: ten tables with RLS, five scoped RPCs, service-only rights, policies and immutable triggers';
END
$test$;

-- Minimal synthetic SQL payloads test the RPC transition contract only.
-- Nutrient values and nutrition calculations are covered by domain/browser tests.
SET LOCAL ROLE service_role;
DO $test$
DECLARE
  owner_id uuid := '10000000-0000-4000-8000-000000000001';
  v_day_id uuid := '30000000-0000-4000-8000-000000000001';
  draft1 jsonb;
  draft2 jsonb;
  draft3 jsonb;
  confirmed jsonb;
  cancelled jsonb;
  saved public.journal_days;
  count_rows bigint;
BEGIN
  draft1 := jsonb_build_object('id',v_day_id::text,'revision',1,'localDate','2026-11-06','timeZone','UTC',
    'meals',jsonb_build_array(jsonb_build_object('id','audit-meal','dayId',v_day_id::text,'revision',1,
      'kind','lunch','label','SQL audit','occurredAt',NULL,'sortOrder',0,'supersedesSnapshotId',NULL,'items','[]'::jsonb)));
  SELECT * INTO saved FROM public.save_journal_day_draft(owner_id,v_day_id,0,draft1);
  IF saved.revision <> 1 THEN RAISE EXCEPTION 'Initial draft revision mismatch'; END IF;
  draft2 := jsonb_set(jsonb_set(draft1,'{revision}','2'::jsonb),'{meals}','[]'::jsonb);
  confirmed := jsonb_build_object('snapshotId','audit-confirmed','logicalMealId','audit-meal',
    'revision',1,'supersedesSnapshotId',NULL,'dayId',v_day_id::text,'localDate','2026-11-06','timeZone','UTC',
    'status','confirmed','mealKind','lunch','label','SQL audit','occurredAt',NULL,'sortOrder',0,
    'mealRevision',1,'dayRevision',1,'confirmedAt','2026-11-06T12:00:00Z',
    'engineVersion','sql-audit-only','items','[]'::jsonb,'totals','{}'::jsonb);
  PERFORM * FROM public.append_journal_snapshot(owner_id,v_day_id,1,draft1,draft2,confirmed);
  draft3 := jsonb_set(draft2,'{revision}','3'::jsonb);
  cancelled := confirmed || jsonb_build_object('snapshotId','audit-void','revision',2,
    'supersedesSnapshotId','audit-confirmed','status','void','dayRevision',2,
    'confirmedAt','2026-11-06T12:01:00Z','voidReason','cancelled','totals','[]'::jsonb);
  PERFORM * FROM public.append_journal_snapshot(owner_id,v_day_id,2,draft2,draft3,cancelled);
  SELECT revision INTO count_rows FROM public.journal_days WHERE id=v_day_id AND user_id=owner_id;
  IF count_rows <> 3 THEN RAISE EXCEPTION 'Cancellation failed to advance the day revision'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.journal_meal_snapshots s WHERE s.user_id=owner_id AND s.day_id=v_day_id AND s.status='confirmed'
      AND NOT EXISTS (SELECT 1 FROM public.journal_meal_snapshots child WHERE child.user_id=s.user_id AND child.predecessor_snapshot_id=s.snapshot_id)
  ) THEN RAISE EXCEPTION 'Cancelled meal remains an active confirmed head'; END IF;
  BEGIN
    PERFORM * FROM public.save_journal_day_draft(owner_id,v_day_id,2,jsonb_set(draft1,'{revision}','3'::jsonb));
    RAISE EXCEPTION 'Stale offline copy was incorrectly accepted after cancellation';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  -- Exact retry is idempotent even though the day has advanced.
  PERFORM * FROM public.append_journal_snapshot(owner_id,v_day_id,2,draft2,draft3,cancelled);
  SELECT count(*) INTO count_rows FROM public.journal_meal_snapshots WHERE user_id=owner_id AND day_id=v_day_id;
  IF count_rows <> 2 THEN RAISE EXCEPTION 'Retry duplicated or removed historical snapshots'; END IF;
  RAISE NOTICE 'PASS: confirmation, cancellation, revision advancement, stale-copy rejection and idempotent retry';
END
$test$;
RESET ROLE;
DO $test$
BEGIN
  BEGIN
    UPDATE public.journal_meal_snapshots SET engine_version='mutated' WHERE snapshot_id='audit-confirmed';
    RAISE EXCEPTION 'Historical journal snapshot mutation was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  RAISE NOTICE 'PASS: historical journal snapshot mutation is rejected';
END
$test$;
ROLLBACK;
\echo 'Seven-migration integration assertions passed'
