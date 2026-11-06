# Recette et correctifs préparatoires — 6 novembre 2026

Référence auditée : PR #19 à `c9b321d1b461e9094277d9ae9a8e4f082c9c8a6e`. Travail isolé dans `/tmp/nutriperso-audit-20261106`, branche `codex/audit-integration-20261106`. Aucun worktree existant remplacé, aucun secret lu ou modifié, aucune opération distante SQL, aucun merge ou déploiement. Le plan d’intégration et l’inventaire des PR sont dans [AUDIT_INTEGRATION_20261106.md](./AUDIT_INTEGRATION_20261106.md).

## Résultats réellement exécutés

| Contrôle Linux local | Résultat |
|---|---|
| Baseline `npm test`, `npx tsc --noEmit`, `npm run build` à c9b321d1 | 139/139, TypeScript et Vite/PWA réussis |
| Après correctifs `npm test` | 141/141, zéro échec |
| Après correctifs `npx tsc --noEmit`, `npm run build` | réussis |
| `npm run test:ui:fixtures` | 12/12, Chromium 158.0.8127.18 / Playwright 1.65.0 |
| Compose modèles existant | exit 0, PostgreSQL 17.11 jetable |
| Nouvelle chaîne des sept migrations | exit 0, PostgreSQL 17.11 jetable |
| `git diff --check` | aucune erreur |

Les validations GitHub Actions du nouveau commit sont à consulter sur la PR de correctifs; les preuves de la baseline restent [Actions #119](https://github.com/nabilberger/NutriPerso/actions/runs/42149147588). Les captures de la suite navigateur sont produites dans `test-results/` et archivées par le job `ui-fixtures`. Aucune preuve de parcours connecté à Auth/Worker/Supabase réel n’est revendiquée.

## Parcours navigateur

Six scénarios exécutés chacun sur ordinateur (1440×1000) et émulation mobile Pixel 7 (393×851, tactile). Chaque scénario exige zéro erreur JavaScript et zéro requête réseau `/api/` : les données doivent rester synthétiques.

1. Historique : 20 récents indépendants, page 2 avec quatre repas plus anciens, recherche sans accents, état vide, filtres Depuis/Jusqu’au réinitialisant la pagination, absence de débordement horizontal.
2. Journal : correction directe du repas confirmé de 100 g à 234 g, portion de recette conservée, confirmation explicite, un seul repas actif, totaux 395 kcal / 25,3 g protéines / 22,7 g glucides / 7,4 g lipides / 21,6 g fibres, annulation et zéro actif.
3. Reprise d’une consommation ancienne : nouveau brouillon aujourd’hui avec 123 g, quantité modifiable à 250 g sans auto-confirmation ni modification du repas confirmé existant; suppression du brouillon.
4. Modèles : enregistrement volontaire nommé, renommage, reprise aliment+recette indépendante, conservation du brouillon pendant navigation, suppression annulée puis confirmée.
5. Saisie manuelle : couscous synthétique incomplet (énergie/lipides/fibres inconnus), ajout de pois chiches et résultats partiels `≥` sans fabriquer de valeurs; confirmation, correction et retrait d’un aliment, suppression du brouillon.
6. Clavier : ouverture du menu utilisateur par Entrée, navigation fléchée, Échap et retour du focus.

Les captures `corrected-234g.png`, `partial-nutrients.png` et `history.png` sont générées pour les deux formats. Les captures mobile et ordinateur ont été inspectées. Il s’agit d’émulation Chromium, pas d’un essai matériel Android/caméra. L’ouverture du navigateur intégré via `open_in_codex` a retourné `queued`; aucun outil de contrôle de cet onglet n’était exposé. Les parcours ci-dessus ont réellement été pilotés dans Chromium par Playwright, pas dans cet onglet intégré.

## Anomalies reproduites et réparées

- Pagination : depuis page 2, filtrer aujourd’hui donnait « Aucun résultat » et `21–1 / 1`. Les deux dates remettent désormais l’offset à zéro; test navigateur des deux dates.
- Saisie manuelle en fixtures : la recherche envoyait encore une requête au proxy Vite, sans Worker; erreur « recherche USDA indisponible ». Le catalogue passe maintenant par un adaptateur commun : synthétique en recette, transport existant en connecté. Les deux fiches fictives et la liste recettes sont simulées. Le pois chiche demeure complet et le couscous volontairement incomplet.
- Libellé de correction : corriger directement un repas historique affichait `usda:90001` malgré la fiche épinglée. Le rendu et le libellé accessible du retrait utilisent désormais cette fiche; couvert par le scénario de correction directe.
- Suppression de modèle : une réponse Worker 204 valide était décodée comme JSON, causant une erreur après suppression serveur. Un décodeur HTTP testable accepte 204/205 sans corps, conserve les erreurs 409/503 et refuse toujours le JSON 200 malformé. Tests de réponses synthétiques, sans changement de session ni d’authentification réelle.

Aucun moteur nutritionnel, snapshot métier, migration de production ou secret n’a été changé. L’application des sept fichiers existants dans une base vierge compatible est désormais testée : dix tables/RLS, cinq RPC et droits, anciens overloads supprimés, confirmation → annulation → ancienne copie rejetée → répétition idempotente → historique immuable; les tests modèles existants repassent ensuite. Ce contrôle n’établit pas l’équivalence du schéma distant ni la sûreté d’un backfill sur données réelles.

## Limites fonctionnelles et opérations à décider

Le lot #4 possède maintenant des preuves navigateur synthétiques; les modèles ne proposent encore que création/renommage/suppression/reprise, sans éditeur de composition. Recettes : bibliothèque de lecture et moteur, mais pas éditeur/confirmation/ajout complet exposés. Catalogue personnel/local, autres mensurations, onboarding/Mifflin/objectifs datés, calendrier, Gemini, rappels, export/restauration restent à développer selon leurs tickets. Les photos caméra/galerie sont deux PR concurrentes à départager, pas deux lots à fusionner.

Avant mise en service : parcours connecté sur environnement isolé, isolation preview/API/Auth, équivalence SQL distante à partir des preuves historiques, sauvegarde restaurée et autorisations ciblées. Le test de base vierge ne remplace aucune de ces décisions.

## Reproduction

Dans une copie de travail isolée dotée de Node et Docker :

```sh
npm ci
npm test
npx tsc --noEmit
npm run build
npx playwright install chromium --only-shell
npm run test:ui:fixtures
# Chaque commande crée sa propre pile, sans port publié et avec PostgreSQL en tmpfs.
docker compose -p nutriperso-audit-models -f docker-compose.integration.yml up --abort-on-container-exit --exit-code-from test
docker compose -p nutriperso-audit-migrations -f docker-compose.migrations.yml up --abort-on-container-exit --exit-code-from test
```

Le lanceur Codex standard ne trouve pas `bwrap` dans ce processus; l’exécution directe autorisée a fonctionné. Node est présent sous `/home/cadencepo/.nvm/versions/node/v26.13.0/bin`, absent du PATH initial. Chromium manquait de `libnspr4`, `libnss3`, `libasound2`; ces paquets ont été téléchargés et extraits sous `/tmp/nutriperso-browser-libs`, sans installation système, puis exposés uniquement au processus navigateur via `LD_LIBRARY_PATH`. Les tests locaux ont utilisé ce chemin. Sur Actions Ubuntu, `playwright install --with-deps` prépare le runner jetable. Les conteneurs Supabase locaux préexistants sont restés actifs et inchangés; les deux piles d’audit sont arrêtées et conservées.

Publication de la branche : préfixe de commit `[CF-Pages-Skip]` pour omettre la preview automatique, conformément à la [documentation Pages GitHub](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/#skipping-a-build-via-a-commit-message). Le workflow ajouté ne déploie rien. Aucune fusion automatique n’est configurée.
