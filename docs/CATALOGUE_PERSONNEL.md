# Catalogue personnel — ticket #5, Mission 012

Base : `design/nutriperso-editorial-dashboard` à `bb731ac1`.

## Fonctions et démonstration

Dans Aliments → Source du catalogue → Mes fiches personnelles : créer une fiche,
saisir le nom, catégorie, référence et notes, puis les cinq valeurs pour **100 g ou
100 ml**. Une valeur vide est inconnue, `0` est un zéro explicite. Énergie : kcal/kJ ;
macronutriments et fibres : g/mg. Les virgules deviennent des décimales exactes en
chaînes ; aucune valeur nutritionnelle n'est calculée avec des flottants JavaScript.
Le moteur existant calcule et affiche kcal à l'unité, grammes à une décimale.

Une équivalence indique **1 portion nommée = une quantité explicite en g ou ml** :
pièce, tranche, cuillère à café, cuillère à soupe ou portion personnalisée (verre…).
Une quantité équivalente vide demeure inconnue. Chaque modification de fiche
incrémente sa révision et la version des équivalences. Leur identifiant reste stable
pendant l'édition ; le retrait d'une équivalence ne réécrit aucun historique.

Les fiches enregistrées sont immédiatement recherchables dans le sélecteur du
journal et celui des recettes. Une nouvelle consommation reprend les valeurs et
équivalences actuelles. Un brouillon existant recharge les références personnelles ;
une panne réseau conserve son dernier cache, tandis qu'une fiche devenue indisponible
reste nommée avec apports inconnus. Les réponses retardées ne remplacent pas une
source sélectionnée plus récemment. Les corrections historiques restent épinglées
à leurs snapshots existants, selon le comportement validé du journal.

Archiver retire la fiche des sélecteurs ; elle reste consultable en lecture seule
avec « Afficher les fiches archivées ». Les snapshots de repas et recettes confirmés
conservent leurs valeurs, sources et équivalences. Une révision périmée est rejetée,
sans écrasement : la saisie est gardée et « Recharger la fiche » permet de reprendre
explicitement la version actuelle. Une erreur réseau ne signale jamais une sauvegarde réussie.

Le catalogue est accessible aussi depuis la navigation mobile (entrée Aliments).

```bash
npm ci
VITE_NUTRIPERSO_UI_FIXTURES=1 npm run dev -- --host 127.0.0.1 --port 4182 --strictPort
```

Le bandeau indique des **données synthétiques**. Le backend fixtures persiste dans
sessionStorage uniquement pour la recette de cet onglet, sans appel API réel.
Parcours automatisé : purée à 100 kcal/100 g, une cuillère = 12,5 g, deux cuillères
→ 25 kcal. Enregistrer un repas et une recette, modifier à 200 kcal/100 g et une
cuillère = 20 g → la nouvelle consommation donne 80 kcal ; les snapshots précédents
restent strictement identiques, même après archivage et rechargement. Des captures
ordinateur/Pixel 7 émulé sont incluses dans les artefacts Playwright de la PR.

## Persistance et sécurité

Réutilisation de `foods` et `food_nutrients`. La migration
`20261106183939_personal_food_catalog.sql`, générée par le CLI, ajoute propriétaire,
révision, archivage et document JSON canonique (avec équivalences) à `foods`.
`save_personal_food` écrit fiche, portions et projection des cinq nutriments dans
une transaction ; passer une valeur à inconnue enlève l'ancienne ligne correspondante.
Les autres micronutriments legacy sont conservés. `archive_personal_food` conserve
les données et incrémente la révision. Pas de nouvelle table ni d'algorithme nutritionnel.

L'identité provient exclusivement d'Auth validé par le Worker. Les RPC sont
SECURITY INVOKER, search_path vide et exécutables seulement par service_role.
Les lectures de catalogue combinent références partagées et fiches du propriétaire ;
les fiches d'autrui et archives ne sont pas exposées dans les sélecteurs.
Les droits directs de tables restent ceux du catalogue existant, service-only.
Les imports USDA ne peuvent pas remplacer une fiche personnelle.

Routes authentifiées :
- `GET /api/private/personal-foods` (liste, archives incluses) ;
- `GET /api/private/personal-foods/:id` (document du propriétaire) ;
- `PUT /api/private/personal-foods/:id`, `{document, expectedRevision}` ;
- `DELETE /api/private/personal-foods/:id`, `{expectedRevision}` ;
- recherche/fiche via les routes `catalog` existantes, désormais filtrées par propriétaire.

Le Worker et la migration doivent être mis en service ensemble après validation.
Aucune migration distante, publication ni modification de secret n'a été effectuée.
Aucune nouvelle dépendance ou variable applicative n'est nécessaire.

## Anciennes fiches et conditions de migration

Si des lignes custom non attribuées existent, la migration ne les attribue que si
le projet contient **exactement un utilisateur Auth**. Sinon elle s'arrête : le
superviseur doit établir le propriétaire avant une application explicitement autorisée.
Les lignes USDA/locales restent partagées, sans propriétaire personnel.

Les anciennes fiches custom sur une base commune de 100 g ou 100 ml sont reprises
sans arrondi (y compris valeurs décimales et alias historiques). Une ancienne fiche
avec bases non standard/mélangées ou unités non prises en charge nécessite une
conversion explicite avant édition ; le serveur refuse de réinterpréter silencieusement
ses valeurs. Elle reste consultable dans le catalogue et archivable depuis la liste.
La migration ne réécrit pas ses nutriments ni les snapshots.

## Tests et bilan de couverture #5

```bash
npm test
npx tsc --noEmit
npm run test:types:ui
npm run build
npm run test:ui:fixtures
docker compose -p nutriperso-personal-migrations -f docker-compose.migrations.yml up --abort-on-container-exit --exit-code-from test
```

La chaîne comprend désormais **huit migrations**. Les tests SQL vérifient précision,
null vs zéro, refus interutilisateur et révisions périmées, rollback après une panne
injectée dans l'écriture des nutriments, droits, archivage idempotent et snapshots.
Deux connexions PostgreSQL asynchrones réelles écrivent sous service_role avec la
même révision : exactement une gagne. La mise à niveau legacy teste attribution
avec propriétaire unique et rejet atomique si l'attribution est ambiguë. Les erreurs
SQL de ces deux scénarios négatifs sont attendues et leurs assertions doivent réussir.
Les extensions dblink et bases supplémentaires sont **uniquement des fixtures SQL**
dans le conteneur isolé, jamais des changements du schéma applicatif.

| Critère #5 | Couverture livrée |
|---|---|
| Recettes : création, édition, portions, confirmation, journal | Sous-lot Recettes déjà intégré ; suite conservée |
| USDA et catalogue local | Sélecteurs existants préservés |
| Fiches personnelles : créer, consulter, modifier, archiver | UI + Worker + RPC + tests |
| Valeurs, unités et bases exactes ; inconnus distincts de zéro | Modèle partagé, moteur inchangé, tests |
| Portions alimentaires spécifiques et versions | Éditeur, journal/recettes et snapshots testés |
| Historiques immuables après édition/archivage | Domaines, SQL et comparaison intégrale dans le navigateur |
| PC et mobile | Chromium ordinateur + Pixel 7 émulé ; Android physique non revendiqué |

La couverture est du code et de la CI isolée. Le parcours navigateur n'utilise pas
Supabase distant ; Auth/Data API sont simulés dans les tests Worker, complétés par
PostgreSQL réel. Recette sur environnement raccordé et déploiement restent distincts.
Le ticket #5 reste ouvert jusqu'à décision de supervision ; aucune fermeture/ fusion automatique.
