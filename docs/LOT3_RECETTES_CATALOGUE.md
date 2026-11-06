# Lot 3 — éditeur de recettes et catalogue existant

Branche de départ : `design/nutriperso-editorial-dashboard`, `20630e79`.
Ticket de référence : #5. Le cahier des charges reste inchangé.

## Parcours

Depuis Recettes, créer une préparation, renseigner nom, description, étapes,
ingrédients, quantités, unités (g/kg/ml/l), nature du poids et nombre de portions.
Le poids final comestible est facultatif et permet ensuite une consommation en grammes.
Les décimales avec virgule sont normalisées en chaînes exactes. Le moteur existant
calcule la recette complète et une portion ; aucune valeur inconnue n'est remplacée
par zéro. Une incompatibilité masse/volume reste inconnue sans conversion attestée.

Enregistrer le brouillon ne confirme rien. Confirmer crée un instantané calculé
côté Worker à partir des sources résolues côté serveur. Utiliser la version confirmée
crée un nouveau brouillon du journal, modifiable en portions ou grammes lorsque le
poids final est connu. La confirmation du repas reste une action explicite.

Modifier puis confirmer une recette crée une nouvelle version ; les repas déjà
confirmés conservent leurs sources, quantités et fractions historiques. Supprimer
retire la recette de la bibliothèque via `draft.archived`, sans effacer les snapshots.
Les modifications non enregistrées demandent confirmation avant abandon dans l'éditeur.
Les erreurs de sauvegarde gardent la saisie ; une confirmation échouée après sauvegarde
laisse un brouillon enregistré et peut être réessayée sans créer de doublon.

## Catalogue

L'éditeur réutilise le sélecteur USDA du journal. Le catalogue local/personnel est
recherchable et consultable dans Aliments et dans l'éditeur. Les fiches sont lues
sans import ni écrasement, avec leur provenance et leurs bases nutritionnelles exactes.
Les identifiants de catalogue historiques (UUID nus) restent compatibles.

Cette livraison utilise les ingrédients personnels **déjà disponibles** dans les
tables existantes, conformément au périmètre de la mission. Elle ne livre pas un
éditeur de fiches alimentaires ni la création d'équivalences de portions alimentaires.
Ces exigences V1 du catalogue restent à suivre dans #5 ; le ticket n'est pas clos
par cette PR. Les portions de **recettes** et les unités physiques sont opérationnelles.

## Contrats et données

Routes authentifiées :
- `GET /api/private/catalog?q=...` et `GET /api/private/catalog/:id` ;
- `GET /api/private/recipes`, `GET /api/private/recipes/:id` ;
- `PUT /api/private/recipes/:id/draft` avec `expectedRevision` ;
- `POST /api/private/recipes/:id/confirm` avec `expectedRevision` et
  `expectedPredecessorSnapshotId`, sans totaux/sources envoyés par le navigateur ;
- `DELETE /api/private/recipes/:id` avec `expectedRevision` (archivage logique).

Tables/RPC existantes réutilisées : `foods`, `food_nutrients`, `recipes`,
`recipe_snapshots`, `save_recipe_draft`, `append_recipe_snapshot`.
Description, préparation et archivage sont des champs JSON facultatifs du brouillon.
Aucune nouvelle migration, dépendance npm, variable ou secret. Les calculs du moteur
ne changent pas ; seul le type du brouillon accepte ces métadonnées.
La version du Worker livrant ces routes devra être déployée avant leur utilisation
réelle ; aucun déploiement ou changement distant ne fait partie de cette livraison.

## Démonstration locale isolée

Après installation des dépendances dans un checkout séparé :

```bash
npm ci
VITE_NUTRIPERSO_UI_FIXTURES=1 npm run dev -- --host 127.0.0.1 --port 4182 --strictPort
```

Le bandeau indique explicitement les données synthétiques. Les recettes et le journal
synthétiques sont conservés dans sessionStorage entre rechargements de cet onglet.
Aucune requête API réelle ne doit être émise. Cette simulation n'est pas une preuve
de fonctionnement contre Supabase distant, d'authentification réelle ou de PWA hors ligne.

Démo reproduite par `tests/ui/recipes.spec.ts` : 200 g de pois chiches synthétiques
+ 100 g de farine personnelle synthétique, deux portions → 443 kcal, 27,8 g protéines,
36 g glucides, 10,2 g lipides, 18,2 g fibres ; par portion 222 kcal et 13,9 g protéines.
Le test sauvegarde, recharge, utilise une portion dans le journal, modifie la recette,
vérifie le nouveau calcul puis supprime la recette et compare intégralement l'ancien
snapshot du repas. Des captures ordinateur/mobile sont jointes aux artefacts CI.

## Vérifications

```bash
npm test
npx tsc --noEmit
npm run test:types:ui
npm run build
npm run test:ui:fixtures
docker compose -p nutriperso-recipes-migrations -f docker-compose.migrations.yml up --abort-on-container-exit --exit-code-from test
```

La suite PostgreSQL ajoute `recipe-editor.integration.sql` au test existant de la
chaîne des sept migrations. Elle vérifie métadonnées, révisions, refus interutilisateur
et conservation d'un snapshot après archivage, sur PostgreSQL isolé sans port publié.
Les tests du Worker utilisent Auth/Data API/USDA simulés, en complément du SQL réel.
Les tests navigateur utilisent Chromium ordinateur et Pixel 7 émulé, pas un Android physique.
Les résultats et SHA définitifs figurent dans la PR.
