\echo 'Upgrade existing custom entries without guessing their Auth owner'
CREATE DATABASE nutriperso_personal_legacy;
CREATE DATABASE nutriperso_personal_ambiguous;
DO $upgrade$
DECLARE catalog_sql text:=pg_read_file('/docker-entrypoint-initdb.d/20261103175325_food_catalog.sql');
 migration_sql text:=pg_read_file('/docker-entrypoint-initdb.d/20261106183939_personal_food_catalog.sql');
 connection text; chosen_owner text; missing_columns int; result text;
BEGIN
 FOREACH connection IN ARRAY ARRAY['nutriperso_personal_legacy','nutriperso_personal_ambiguous'] LOOP
  PERFORM dblink_connect(connection,'host=127.0.0.1 dbname='||connection||' user=postgres password=local-only-nutriperso');
  PERFORM dblink_exec(connection,$schema$CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   INSERT INTO auth.users VALUES('10000000-0000-4000-8000-000000000001');$schema$);
  PERFORM dblink_exec(connection,catalog_sql);
  PERFORM dblink_exec(connection,$seed$INSERT INTO public.foods(id,source_type,description,source_reference) VALUES('60000000-0000-4000-8000-000000000080','custom','Legacy source','Original reference');
   INSERT INTO public.food_nutrients(food_id,nutrient_code,nutrient_name,value,unit,reference_quantity,reference_unit,basis_source)
   VALUES('60000000-0000-4000-8000-000000000080','protein','Protein',1.234567890123456789,'g',100,'g','manual');$seed$);
 END LOOP;
 PERFORM dblink_exec('nutriperso_personal_legacy','BEGIN;'||migration_sql||';COMMIT;');
 SELECT user_id INTO chosen_owner FROM dblink('nutriperso_personal_legacy','SELECT user_id::text FROM public.foods WHERE source_type=''custom''') AS t(user_id text);
 IF chosen_owner IS DISTINCT FROM '10000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'Legacy owner not assigned exactly';END IF;
 IF NOT EXISTS(SELECT 1 FROM dblink('nutriperso_personal_legacy','SELECT value::text FROM public.food_nutrients WHERE nutrient_code=''protein''') AS t(value text) WHERE value='1.234567890123456789') THEN RAISE EXCEPTION 'Legacy nutrient precision changed';END IF;
 PERFORM dblink_exec('nutriperso_personal_ambiguous','INSERT INTO auth.users VALUES(''10000000-0000-4000-8000-000000000002'')');
 result:=dblink_exec('nutriperso_personal_ambiguous','BEGIN;'||migration_sql||';COMMIT;',false);
 IF result<>'ERROR' THEN RAISE EXCEPTION 'Ambiguous legacy ownership was silently assigned';END IF;
 PERFORM dblink_exec('nutriperso_personal_ambiguous','ROLLBACK');
 SELECT count INTO missing_columns FROM dblink('nutriperso_personal_ambiguous','SELECT count(*)::int FROM information_schema.columns WHERE table_schema=''public'' AND table_name=''foods'' AND column_name=''user_id''') AS t(count int);
 IF missing_columns<>0 THEN RAISE EXCEPTION 'Ambiguous upgrade did not roll back';END IF;
 PERFORM dblink_disconnect('nutriperso_personal_legacy');PERFORM dblink_disconnect('nutriperso_personal_ambiguous');
 RAISE NOTICE 'PASS: legacy owner backfill, original decimals retained, ambiguous ownership rejected atomically';
END
$upgrade$;
