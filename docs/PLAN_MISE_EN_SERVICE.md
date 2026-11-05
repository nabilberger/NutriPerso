# NutriPerso — Plan de mise en service

État préparatoire au 5 novembre 2026. Ce document prépare les opérations; aucune migration, fusion ou mise en production n’a été effectuée.

## État vérifié

- PR #14 est ouverte et sans conflit : branche feat/3-journal-alimentaire à 888e226c7722b309136ac524e5adbd5df5ef40dc, 3 commits devant et aucun derrière la branche design/nutriperso-editorial-dashboard.
- PR #1 est ouverte en brouillon et sans conflit : branche design à b75f0fcad1e659ce780e8e4dd0c6d292bde3bde9, 34 commits devant et aucun derrière main. La fusion vers main déclenche la publication Pages.
- Six migrations locales existent. Quatre versions différentes sont inscrites à distance : 20261104154243 (recettes), 20261104165446 (journal), 20261104165450 (propriété recettes), 20261104234832 (profils/mesures). Le schéma correspondant est déjà présent. Le marqueur catalogue manque. La nouvelle migration 20261105183000 n’est pas appliquée.
- Les huit tables attendues sont présentes et RLS est activée. Les colonnes, clés, contraintes, index et politiques inspectés correspondent aux migrations de catalogue, recettes, journal, propriété des recettes et profils/mesures.
- Les RPC recettes ont search_path vide et sont exécutables par service_role seulement (pas anon ni authenticated). append_journal_snapshot est Security Invoker, search_path vide et exécutable par service_role seulement.
- La RPC distante `append_journal_snapshot` est `SECURITY INVOKER`, `search_path` vide, exécutable uniquement par `service_role`. Son différentiel fonctionnel avec `20261105183000` est confirmé : pour `void`, elle accepte `p_next_draft=p_expected_draft`, conserve `next_revision=current_day.revision` et n’actualise pas `journal_days`; la migration locale impose `revision+1`, retire le brouillon correspondant et met à jour `journal_days`. Cette migration est fonctionnellement nécessaire et non appliquée.
- Pages production sert le commit 0b0b9d41ece4a9a5dab7988afd39eb615ab17fe2. Preview de `feat/3-journal-alimentaire` sert le HEAD `888e226c7722b309136ac524e5adbd5df5ef40dc` (5 novembre 2026). Les noms de variables VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY existent en preview et production; leurs valeurs ne sont pas exposées. L’association effective à Auth doit être vérifiée sans divulgation avant mise en service.
- La route nutri.brainboost3d.com/api/* pointe vers nutri-perso-api. Les bindings FDC_API_KEY, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY et SUPABASE_URL existent par nom. La version à 100 % (d2c8091e-5f0a-40bb-a711-5384e956d5b5, 4 novembre) ne contient pas les routes Lot 0 de profil et mesures. La valeur de SUPABASE_URL Worker n’est pas consultable par l’API Cloudflare.
- Le CLI Supabase n’est pas installé dans l’environnement inspecté. Les fichiers non suivis supabase/config.toml et supabase/.gitignore doivent être conservés.

Migrations locales :

| Version | Nom |
|---|---|
| 20261103175325 | food_catalog |
| 20261104143804 | recipe_persistence |
| 20261104160000 | journal_persistence |
| 20261104170000 | recipe_user_ownership |
| 20261104234000 | user_profiles |
| 20261105183000 | journal_delete_precedence |

## Réconciliation du registre — procédure à autoriser

La réconciliation vise les marqueurs d’historique uniquement. Elle ne doit pas rejouer les créations SQL déjà reflétées dans le schéma.

Prérequis : autorisation explicite, sauvegarde restaurable du projet (backup/PITR selon le forfait), export du schéma dans un emplacement protégé hors Git, copie de la liste des migrations, et suspension des opérations concurrentes. Une sauvegarde schéma seule ne sauvegarde pas les données.

Après liaison explicite au projet vrpiwifrlbhdordahmik et nouvelle comparaison des objets distants, l’opérateur pourrait remplacer les quatre versions inscrites par les cinq versions locales correspondant au schéma déjà appliqué :

    npx supabase migration repair 20261104154243 20261104165446 20261104165450 20261104234832 --status reverted --linked
    npx supabase migration repair 20261103175325 20261104143804 20261104160000 20261104170000 20261104234000 --status applied --linked
    npx supabase migration list --linked
    npx supabase db push --linked --dry-run

Le résultat attendu de migration list/dry-run est une seule migration en attente : 20261105183000_journal_delete_precedence.sql. Si une autre migration ou opération apparaît, arrêter. La commande db push réelle ne peut être exécutée qu’après autorisation distincte.

Attention : migration repair change seulement le registre; elle n’applique ni n’annule le SQL. Ne jamais utiliser db reset --linked. Si le registre est incorrect avant l’application SQL, la procédure inverse des marqueurs (après inspection de l’état réellement inscrit) est :

    npx supabase migration repair 20261103175325 20261104143804 20261104160000 20261104170000 20261104234000 --status reverted --linked
    npx supabase migration repair 20261104154243 20261104165446 20261104165450 20261104234832 --status applied --linked
    npx supabase migration list --linked

Ne pas appliquer cette procédure après le push SQL. Vérifier les versions et noms après chaque opération.

## Ordre d’intégration et de sortie

1. Après autorisation de fusion, intégrer PR #14 dans design. Recontrôler son HEAD et les vérifications GitHub.
2. Actualiser PR #1, examiner son diff complet et ses checks. Sa description est à mettre à jour pour inclure le journal; elle est en brouillon.
3. Dans une fenêtre coordonnée et autorisée, effectuer la sauvegarde, réconciliation, vérification du dry-run, puis appliquer la seule migration 20261105183000.
4. Déployer aussitôt le Worker depuis le code intégré et validé. Le changement de RPC et le changement Worker sont incompatibles pendant une transition prolongée : l’ancienne RPC ne satisfait pas le nouveau contrat d’annulation, tandis que l’ancien Worker peut ne pas satisfaire la nouvelle RPC. Prévoir une fenêtre courte et surveillée.
5. Commandes locales de validation et publication du Worker :

    npm ci
    npm test
    npx tsc --noEmit
    npm run build
    npm run worker:deploy

6. Vérifier la version déployée, la route API, et les bindings par leur seul nom. Tester d’abord la recherche publique USDA et les lectures authentifiées de profil/mesures sans écriture. Les essais d’écriture journal ne requièrent qu’un compte de test et une autorisation explicite.
7. Rendre PR #1 prête et la fusionner dans main seulement après autorisation de mise en production. La fusion déclenche Pages. Vérifier le commit de déploiement sur nutri.brainboost3d.com, puis les parcours authentifiés Lot 0 et journal.

Le déploiement Preview de PR #14 ne prouve pas que le routage /api/* soit celui de production.

## Retour arrière

- Pages : rétablir via le contrôle Pages le déploiement précédent identifié par le commit 0b0b9d41ece4a9a5dab7988afd39eb615ab17fe2, ou publier un correctif validé. Cela ne revient ni sur le Worker ni sur SQL.
- Worker : version précédente connue d2c8091e-5f0a-40bb-a711-5384e956d5b5. Commande d’urgence documentée par Wrangler :

    npx wrangler rollback d2c8091e-5f0a-40bb-a711-5384e956d5b5 --name nutri-perso-api

Cette version n’a pas les routes profil/mesures et peut être incompatible avec la RPC mise à jour. Ce rollback implique une perte fonctionnelle temporaire; privilégier un correctif en avant. Il ne restaure ni SQL ni données.
- Base : aucun rollback SQL automatique n’est fourni. En cas de défaut, conserver la fonction corrigée, suspendre l’opération touchée et préparer un correctif SQL en avant, sauvegardé et autorisé. Ne pas marquer la migration reverted pour simuler un rollback SQL.

## Blocages et conditions d’arrêt

- Réconciliation du registre et dry-run restent à effectuer par un CLI Supabase approuvé.
- Migration journal_delete_precedence absente à distance.
- Worker production ancien et routes Lot 0 absentes.
- Valeur du secret Worker SUPABASE_URL à valider fonctionnellement sans l’afficher.
- Fusion PR #14, mise à jour/fusion PR #1, migration et déploiements nécessitent chacun une autorisation.
- Arrêter si l’état GitHub, le schéma, les versions, les droits RPC ou le dry-run diffèrent des constats ci-dessus.

## Périmètre réalisé

Les inspections ayant servi à ce plan sont en lecture seule. Le seul changement GitHub de cette mission est l’ajout de ce document à la branche de la PR #14. Aucune réparation d’historique, migration distante, écriture de données, fusion ni mise en production n’a été effectuée.


## Décision de mise en service — preuves superviseur (5 novembre 2026)

- **Confirmé en lecture seule :** Supabase `NutriPerso` (`vrpiwifrlbhdordahmik`), `ACTIVE_HEALTHY`, eu-west-1; quatre versions distantes seulement : `20261104154243`, `20261104165446`, `20261104165450`, `20261104234832`. Huit tables public attendues présentes avec RLS. Aucune migration catalogue ni `20261105183000` dans le registre.
- **SQL :** le delta de la RPC d’annulation ci-dessus est matériel. Ne pas faire `migration repair` en supposant que la migration `20261105183000` est déjà représentée par le schéma. Les repair candidates ne sont prêtes qu’après preuve objet-par-objet de l’équivalence des cinq migrations historiques, sauvegarde/restauration testée et validation explicite. Le `db push` de `20261105183000` demande une autorisation distincte et doit suivre le dry-run revu.
- **Cloudflare confirmé :** Pages `nutriperso`, production `main`, domaines `nutriperso.pages.dev` et `nutri.brainboost3d.com`; variables frontend présentes par nom en preview/production. Preview de la branche #14 au HEAD ci-dessus. Worker `nutri-perso-api` déployé à 100 % sur `d2c8091e-5f0a-40bb-a711-5384e956d5b5` le 4 novembre 20:58 UTC; aucun déploiement Lot 1 confirmé. Le plan précédent affirmait sans preuve que les valeurs Pages correspondent au projet : cette affirmation est retirée. La route preview `/api` isolée et les valeurs Pages→Auth restent à vérifier.
- **Prêt sans écriture :** produire la comparaison complète des cinq migrations historiques contre schéma/objets distants, préparer backup+restauration vérifiable, confirmer routage preview isolé et relation variables Pages/Auth sans afficher valeurs, valider CI et le SHA source Worker.
- **Validation nécessaire :** autorisation explicite et ciblée pour réparation du registre, application de `20261105183000`, déploiement Worker, puis merge/Pages production. Aucune de ces opérations n’est autorisée par la présente mise à jour. Plan de transition coordonné RPC/Worker requis pour limiter l’incompatibilité de contrat.

