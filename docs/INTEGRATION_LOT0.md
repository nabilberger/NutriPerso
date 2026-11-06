# Intégration Lot 0 — état et procédure contrôlée

**Référence fonctionnelle :** [CAHIER_DES_CHARGES.md](./CAHIER_DES_CHARGES.md), sans modification.

**Référence de code :** PR #1, branche `design/nutriperso-editorial-dashboard`, HEAD distant vérifié `f4125ca0fa253719eb430b4df1110497324b86ef`.

**Statut :** code vérifié par CI (105 tests déclarés par Codex ; GitHub Actions #38 réussi), mais **pas de validation de bout en bout authentifiée**. Pas de déploiement ni fusion autorisé. Le blocage local actuel de Codex est `CreateProcessSecurityEnvironment failed` (`0x80070001`) lors du lancement WSL ; cela ne constitue pas une défaillance du Worker/Supabase.

## 1. Registre des migrations — faits observés

| Fichier du dépôt | Version enregistrée distante | État |
| --- | --- | --- |
| `20261103175325_food_catalog.sql` | Aucune version correspondante | Les tables `foods` et `food_nutrients` existent ; ne pas rejouer le fichier |
| `20261104143804_recipe_persistence.sql` | `20261104154243` — `recipe_persistence` | Décalage de numérotation |
| `20261104160000_journal_persistence.sql` | `20261104165446` — `journal_persistence` | Décalage de numérotation |
| `20261104170000_recipe_user_ownership.sql` | `20261104165450` — `recipe_user_ownership` | Décalage de numérotation |
| `20261104234000_user_profiles.sql` | `20261104234832` — `user_profiles_and_body_measurements` | Décalage de numérotation |

Vérification MCP (5 novembre 2026) : les huit tables `public.foods`, `public.food_nutrients`, `public.recipes`, `public.recipe_snapshots`, `public.journal_days`, `public.journal_meal_snapshots`, `public.user_profiles` et `public.body_measurements` existent et ont RLS activée. Le rapport Codex indique que les objets SQL examinés concordent, mais **nous ne disposons pas encore d'une comparaison automatisée exhaustive de tous les DDL et droits**.

Les fichiers de migration référencés existent tous dans GitHub. Les fichiers `supabase/config.toml` et `supabase/.gitignore` créés localement par Codex **ne figurent pas** dans la branche GitHub au moment de cette vérification ; le document d'intégration était également absent avant cette rédaction.

## 2. Réconciliation à préparer — ne PAS exécuter

**Condition préalable indispensable :** sauvegarde exploitable, projet distant explicitement identifié, validation des équivalences schéma/fonctions/politiques/trigger, absence de migration partiellement appliquée et consignation du registre actuel.

Hypothèse de réconciliation des seules métadonnées de migration (proposée par Codex, non approuvée pour exécution) :

```bash
supabase migration repair 20261104154243 20261104165446 20261104165450 20261104234832 --status reverted
supabase migration repair 20261103175325 20261104143804 20261104160000 20261104170000 20261104234000 --status applied
supabase migration list
supabase db push --dry-run
```

**Attention :** le mot `reverted` ici vise le registre des migrations, pas une restauration SQL des tables. Cela n'autorise ni un `db push` réel, ni une recréation de structures. Tant que l'équivalence de la migration catalogue et des quatre autres n'a pas été contrôlée avec précision, **ne lancer aucune des commandes ci-dessus**. Consigner les résultats du `--dry-run` et interrompre au moindre changement SQL inattendu.

## 3. Cloudflare / environnement

- Pages : projet `nutriperso`, production sur branche `main`; variables déclarées en preview et production : `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`. Leurs noms ont été vérifiés par MCP. **Les valeurs, leur cohérence avec le projet Auth cible et leur inclusion dans un build donné restent non validées.**
- Worker : routage de production annoncé vers `nutri.brainboost3d.com/api/*`. Une requête publique USDA a fonctionné selon le rapport Codex. La présence effective du code récent profil/poids dans le Worker déployé n'est **pas démontrée**.
- Pages preview : l'hôte preview ne route pas `/api/*` vers le Worker de production. Il ne permet pas, à lui seul, le test complet.
- Variables et secrets Worker : noms `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `FDC_API_KEY` annoncés présents ; ne jamais copier leurs valeurs dans un ticket, log ou document.
- Déploiement Worker et fusion PR interdits avant accord explicite de supervision.

## 4. Plan pour débloquer les tests, sans dépendance aux identifiants locaux WSL

1. **Récupérer WSL** sur le poste de Codex (diagnostic de l'hôte, pas du code). Vérifier dans PowerShell que `wsl --status` et `wsl -l -v` fonctionnent ; inspecter la couche de virtualisation/WSL avant toute réinstallation. **Ne pas lancer `wsl --unregister` ni supprimer Docker/données.**
2. Faire `git status --short` pour retrouver les fichiers localement créés, sans écraser le checkout distant.
3. Préparer un banc isolé : Supabase local ou projet de test réellement séparé, Worker local/preview avec variables de test, frontend Vite configuré sur la même Auth. Vérifier le routage `/api/*`.
4. Exécuter les tests authentifiés (création d'un utilisateur de test via la méthode prévue par Auth, sans inscription publique), puis effectuer les opérations de test uniquement dans l'environnement isolé.
5. Publier les résultats dans le ticket #13 et la PR #1 avant décision finale.

### Parcours de recette minimum

- PC et smartphone : connexion/déconnexion, maintien de la session.
- Menu compte : ouverture depuis avatar/nom, clic extérieur, Échap, flèches/Home/End et focus.
- Profil : afficher, changer nom et préférences, importer/retirer photo, sauver, recharger, vérifier les données persistées.
- Poids : ajouter deux mesures, lire courbe/historique, supprimer une mesure, recharger.
- Catalogue : rechercher et ouvrir une fiche USDA ; consigner les limites de pagination.
- Recettes : liste vide ou existante sans valeurs factices ; création/édition renvoyées au Lot 3.
- Isolation : sessions différentes ne doivent pas lire/écrire les données de l'autre.
- Tous les écrans : chargement, erreurs réseau, clavier, mobile sans débordement.

## 5. Critères de clôture

Le **Lot 0 n'est PAS terminé sur le plan fonctionnel** jusqu'à publication des preuves E2E authentifiées. Ne pas confondre « CI verte », « code en preview », « Worker en production » et « recette acceptée ». La prochaine mission ne doit pas revenir à un audit général : elle traite WSL/banc de test, divergence du registre migratoire et validation sur environnement isolé.

## 6. État des documents

Cette note est rédigée via GitHub MCP directement, afin d'éviter le blocage WSL de Codex. Elle se fonde sur ses rapports et sur les contrôles MCP GitHub/Supabase réalisés par le superviseur. Tout résultat non directement contrôlé est signalé comme tel.
