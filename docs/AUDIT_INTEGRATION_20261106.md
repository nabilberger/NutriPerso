# Audit préparatoire d’intégration — 6 novembre 2026

Relevé Git/GitHub en lecture seule au début de la mission, référence fonctionnelle `c9b321d1b461e9094277d9ae9a8e4f082c9c8a6e`. Ce document ne vaut ni autorisation de fusion ni autorisation de publication. Résultats navigateur et correctifs de la mission : voir le rapport de recette associé.

## État préservé

- Dépôt principal `/home/cadencepo/projects/NutriPerso` : branche `feat/4-meal-history-reuse`, HEAD `5aaae2ca224c43bfd085d051e975c833120de19b`, 13 commits derrière `origin/feat/4-meal-history-reuse`.
- Quatre fichiers suivis modifiés : `README.md`, `package.json`, `src/journal-sources.ts`, `vite.config.ts`. Huit fichiers non suivis : `scripts/dev-fixtures.mjs`, `scripts/dev-stack-config.mjs`, `scripts/dev-stack.mjs`, `src/dev-ui-fixtures.ts`, `src/ui-fixture-mode.ts`, `supabase/.gitignore`, `supabase/config.toml`, `worker/test/ui-fixtures.test.ts`. Ces éléments sont conservés, sans reset, stash ou substitution.
- Worktree `/home/cadencepo/projects/NutriPerso-fixtures` : HEAD détaché `c9b321d1`, propre au relevé initial. Il est conservé.
- La branche locale `feat/3-journal-alimentaire` est à `27e61d7cdda849ac97d95a399ab06287b053301c`, avec 1 commit propre / 5 commits distants. `git cherry` marque toutefois ce commit `-` : patch équivalent au commit distant `d4f7bfb`. Le diff de `27e61d7` vers `a7ce768` ne contient que le plan documentaire. Préserver la référence locale; aucun code inédit à reporter n’a été trouvé dans ce delta.
- Le chemin CWD fourni par l’application est mal traduit. L’accès au vrai dépôt WSL fonctionne par `/home/cadencepo/projects/...`. Le lanceur standard signale encore `bubblewrap is unavailable`; l’exécution explicitement approuvée hors de ce lanceur permet les lectures. Aucun changement système n’a été effectué pour contourner ce défaut.

## PR et graphe vérifiés

| PR | Tête exacte | Base | État au relevé |
|---|---|---|---|
| [#1](https://github.com/nabilberger/NutriPerso/pull/1) | `b75f0fcad1e659ce780e8e4dd0c6d292bde3bde9` | `main` à `0b0b9d41ece4a9a5dab7988afd39eb615ab17fe2` | ouverte, brouillon, mergeable |
| [#14](https://github.com/nabilberger/NutriPerso/pull/14) | `a7ce76818c108a0d270f2c05ba5bd308e90b01d0` | `design/nutriperso-editorial-dashboard` | ouverte, mergeable |
| [#17](https://github.com/nabilberger/NutriPerso/pull/17) | `76d10ad22df23a7c120750a92a40361f25e485fe` | `feat/3-journal-alimentaire` | ouverte, brouillon, mergeable |
| [#18](https://github.com/nabilberger/NutriPerso/pull/18) | `c8a0718a4847b683e4a567f0ff76dde38f5eabae` | `feat/3-journal-alimentaire` | ouverte, brouillon, mergeable |
| [#19](https://github.com/nabilberger/NutriPerso/pull/19) | `c9b321d1b461e9094277d9ae9a8e4f082c9c8a6e` | `feat/3-journal-alimentaire` | ouverte, brouillon, mergeable |

Les références distantes locales correspondent aux SHA GitHub ci-dessus. `git rev-list --left-right --count` donne : `main...design = 0/34`, `design...feat3 = 0/7`, `feat3...feat4 = 0/68`. La chaîne principale est donc entièrement ancestrale au relevé; les lots ne sont pas trois implémentations concurrentes.

## Doublons et conflits réels

- #17 et #18 réalisent le même lot caméra/galerie, depuis le même commit `a7ce768`. Toutes deux modifient `package.json`, `src/Journal.tsx`, `worker/test/photo-source.test.ts`; aucun scanner ni nouvelle migration. Choisir une seule implémentation après revue, ne pas intégrer les deux.
- Calcul trois voies non mutant avec la forme historique `git merge-tree BASE LEFT RIGHT` : #17 contre #18 produit des conflits dans `src/Journal.tsx` et l’ajout concurrent `worker/test/photo-source.test.ts`.
- Chacune des PR photo contre #19 produit des conflits dans `package.json` et `src/Journal.tsx`. Le statut GitHub « mergeable » de chaque PR séparément ne prouve pas leur compatibilité entre elles. Conserver tous les tests du lot #4, les UUID compatibles et les fonctionnalités caméra/galerie lors de la résolution.
- Les trois voies ont été calculées sans fusion de branche, sans changement de référence, d’index ou de fichier de travail.

## Preuves CI et périmètre fonctionnel

- #1 et #14 ont des checks `verify` réussis à leurs SHA actuels.
- #19 : [Actions #119](https://github.com/nabilberger/NutriPerso/actions/runs/42149147588), `verify` et `integration-db` réussis. La preuve antérieure publiée indique 139 tests, TypeScript et build réussis. Les résultats de la nouvelle exécution locale doivent être consignés séparément.
- #17 et #18 n’ont que le check Cloudflare Pages au relevé, pas de check Actions `verify`. Cause vérifiée : le workflow déclenche les push `main`, `design/**`, `feat/**`, et les PR vers `main`, `design/**`; `test/** → feat/**` n’est couvert par aucun déclencheur. Une preview Pages réussie n’est pas une preuve d’exécution des tests photo.
- #1 code profil/poids, lecture USDA et bibliothèque de recettes; #14 ajoute le journal; #19 ajoute historique, 20 récents, reprise et modèles. Les parcours synthétiques ne valident pas Auth réel, Worker/PostgREST, ni Supabase distant. Les descriptions de #1/#19 et la matrice de traçabilité restent datées et ne doivent pas remplacer le code et les preuves actuelles.
- Le reste de la V1 n’est pas réputé livré : éditeur de recettes complet, Gemini/photo-analyse, scanner, objectifs datés/onboarding complet, calendrier/statistiques complets, mensurations/rappels/jeûne, exports/sauvegardes restent à rapprocher de leurs tickets. Le Coach est explicitement un écran en préparation dans `App.tsx`.

## Migrations et dépendances

Ordre lexical local, sept fichiers uniques :

1. `20261103175325_food_catalog.sql` — catalogue et nutriments.
2. `20261104143804_recipe_persistence.sql` — recettes/snapshots/RPC et schéma privé.
3. `20261104160000_journal_persistence.sql` — journées/snapshots/RPC journal.
4. `20261104170000_recipe_user_ownership.sql` — propriété Auth des recettes; le backfill s’arrête si des recettes existantes et plusieurs propriétaires possibles rendent l’attribution ambiguë.
5. `20261104234000_user_profiles.sql` — profils/mesures.
6. `20261105183000_journal_delete_precedence.sql` — remplace la RPC journal, contrat d’annulation coordonné avec le Worker.
7. `20261106100000_meal_templates.sql` — deux tables modèles/révisions et RPC atomique `save_meal_template_atomic`; dépend de `auth.users`, des rôles Supabase et du `service_role` côté Worker. RLS activée, accès client révoqué, exécution RPC accordée au seul `service_role`.

Le Compose d’intégration de référence à `c9b321d1` initialise seulement les rôles/Auth minimaux et la migration modèles; il ne démontre pas l’application de l’ensemble de la chaîne historique ni le contrat SQL journal. Un test de toutes les migrations dans une base jetable doit compléter cette preuve avant la décision d’intégration.

Le plan `docs/PLAN_MISE_EN_SERVICE.md` conserve des SHA `888e226` obsolètes et annonce six migrations. Sa condition « une seule migration en attente : journal_delete_precedence » n’est plus correcte si #19 entre dans le périmètre : `meal_templates` s’y ajoute. Ne pas suivre ses commandes de repair/push comme une autorisation.

Les observations distantes du [dernier commentaire de #13](https://github.com/nabilberger/NutriPerso/issues/13#issuecomment-6667840527) sont des preuves du 5 novembre, pas une nouvelle inspection durant cet audit : quatre versions distantes divergentes; delta RPC `void` nécessaire; ancien Worker. L’équivalence exhaustive du schéma, la sauvegarde restaurée, l’isolation API de preview et l’association effective Pages/Auth restent des conditions de mise en service. Aucun accès distant supplémentaire n’a été effectué ici.

## Ordre recommandé à autoriser

1. Terminer les correctifs et la recette dans la branche isolée de cette mission; faire revoir leur PR vers `feat/4-meal-history-reuse`, puis intégrer ces seuls correctifs après accord.
2. Intégrer #19 vers `feat/3-journal-alimentaire`. Au relevé initial, la base est ancêtre de sa tête; revoir les SHA/checks immédiatement avant l’opération.
3. Choisir #17 **ou** #18. Réconcilier l’implémentation choisie avec le nouveau `feat3` dans une branche dédiée, résoudre les deux conflits documentés, rendre son CI réellement déclenchable, puis tests/TypeScript/build/recette photo. Intégrer la seule PR retenue après autorisation; l’autre attend la décision de clôture, sans fusion.
4. Revalider le lot combiné puis intégrer #14 vers `design/nutriperso-editorial-dashboard`. Réexaminer le diff désormais combiné de #1, son descriptif et sa CI.
5. Arrêter avant #1 → `main` tant que la mise en service n’est pas autorisée : ce merge déclenche Pages production. Préparer séparément sauvegarde/restauration, preuve SQL et réparation du registre éventuelle, les deux migrations réellement en attente, Worker et Pages cohérents. Chaque opération distante exige une autorisation ciblée; aucun déploiement n’est inclus dans le présent audit.

Décisions humaines : choix d’une PR photo, validation des PR de correctifs et fusions, éventuelle clôture du doublon, autorisations de repair/migrations et de publication coordonnée. Le code peut être préparé et testé isolément avant ces décisions; aucune donnée locale ou distante importante ne doit être écrasée pour y parvenir.
