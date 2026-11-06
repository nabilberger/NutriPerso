\echo 'Recipe editor: existing JSON storage, scoped revisions and archive preserve immutable snapshots'
BEGIN;
SET LOCAL ROLE service_role;
DO $test$
DECLARE
  owner_id uuid := '10000000-0000-4000-8000-000000000001';
  other_id uuid := '10000000-0000-4000-8000-000000000002';
  recipe_id uuid := '50000000-0000-4000-8000-000000000005';
  draft jsonb;
  snapshot jsonb;
  saved_snapshot jsonb;
BEGIN
  draft := jsonb_build_object('id',recipe_id,'name','Recette SQL synthétique','revision',1,'ingredients','[]'::jsonb,
    'servings','2','finalWeight',null,'description','Description conservée','instructions','Cuire puis servir.');
  PERFORM public.save_recipe_draft(owner_id,recipe_id,0,draft);
  snapshot := jsonb_build_object('schemaVersion','1','snapshotId','recipe-editor-snapshot','engineVersion','sql-contract-test',
    'confirmedAt','2026-11-06T12:00:00Z','recipe',jsonb_build_object('id',recipe_id,'name',draft->>'name','revision',1,'servings','2','finalWeight',null),
    'allocation',jsonb_build_object('kind','total'),'ingredients','[]'::jsonb,'referenceTotals','[]'::jsonb,'totals','[]'::jsonb);
  PERFORM public.append_recipe_snapshot(owner_id,recipe_id,1,null,snapshot);
  SELECT s.snapshot INTO saved_snapshot FROM public.recipe_snapshots s WHERE s.snapshot_id='recipe-editor-snapshot';
  draft := draft || jsonb_build_object('name','Recette modifiée','revision',2,'servings','4');
  PERFORM public.save_recipe_draft(owner_id,recipe_id,1,draft);
  BEGIN
    PERFORM public.save_recipe_draft(owner_id,recipe_id,1,draft || jsonb_build_object('name','Écrasement périmé'));
    RAISE EXCEPTION 'Stale revision unexpectedly accepted';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  BEGIN
    PERFORM public.save_recipe_draft(other_id,recipe_id,2,draft || jsonb_build_object('revision',3));
    RAISE EXCEPTION 'Cross-owner edit unexpectedly accepted';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  draft := draft || jsonb_build_object('revision',3,'archived',true);
  PERFORM public.save_recipe_draft(owner_id,recipe_id,2,draft);
  IF NOT EXISTS (SELECT 1 FROM public.recipes r WHERE r.id=recipe_id AND r.draft->>'archived'='true'
    AND r.draft->>'description'='Description conservée' AND r.draft->>'instructions'='Cuire puis servir.') THEN
    RAISE EXCEPTION 'Archive or recipe metadata not persisted';
  END IF;
  IF (SELECT s.snapshot FROM public.recipe_snapshots s WHERE s.snapshot_id='recipe-editor-snapshot') IS DISTINCT FROM saved_snapshot THEN
    RAISE EXCEPTION 'Historical snapshot changed after edit/archive';
  END IF;
  RAISE NOTICE 'PASS: recipe metadata, scoped stale-write protection, logical archive, historical snapshot unchanged';
END
$test$;
ROLLBACK;
