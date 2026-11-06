# Intégration locale — modèles de repas (Mission 011)

Cette recette utilise uniquement Docker Compose et l'image PostgreSQL 17. Elle n'utilise pas Supabase CLI, aucune clé/token et aucun projet distant. Les seuls comptes sont deux UUID synthétiques déclarés dans `supabase/tests/local/bootstrap.sql`; le mot de passe est un marqueur local de test.

Le conteneur DB utilise `tmpfs`: les données de test disparaissent avec le conteneur. Aucun volume utilisateur ni volume Docker nommé n'est utilisé. Seule la migration additive `20261106100000_meal_templates.sql` est appliquée à cette base jetable.

## Depuis WSL2

Depuis la racine du dépôt :

```sh
npm ci
npm test
npx tsc --noEmit
npm run build
npm run test:integration:db
docker compose -p nutriperso-int -f docker-compose.integration.yml down --remove-orphans
```

La dernière commande retire seulement les conteneurs et le réseau du projet Compose `nutriperso-int`; aucun volume n'est supprimé. La base utilise tmpfs et disparaît avec son conteneur.

## Depuis PowerShell

```powershell
wsl.exe -d Ubuntu-24.04 --cd /home/cadencepo/projects/NutriPerso -- npm ci
wsl.exe -d Ubuntu-24.04 --cd /home/cadencepo/projects/NutriPerso -- npm test
wsl.exe -d Ubuntu-24.04 --cd /home/cadencepo/projects/NutriPerso -- npx tsc --noEmit
wsl.exe -d Ubuntu-24.04 --cd /home/cadencepo/projects/NutriPerso -- npm run build
wsl.exe -d Ubuntu-24.04 --cd /home/cadencepo/projects/NutriPerso -- npm run test:integration:db
wsl.exe -d Ubuntu-24.04 --cd /home/cadencepo/projects/NutriPerso -- docker compose -p nutriperso-int -f docker-compose.integration.yml down --remove-orphans
```

Docker Desktop doit rendre Docker Compose accessible depuis la distribution WSL2. Aucun service existant n'est arrêté; le nom de projet dédié isole les conteneurs de cette recette.

## Couverture de la recette SQL

Le script applique la migration réelle puis vérifie :
- création d'un modèle et ajout de la première révision;
- renommage par RPC et conservation des deux versions immuables;
- rejet d'une mise à jour avec révision attendue périmée sans écraser la version courante;
- impossibilité d'écraser le modèle de l'autre utilisateur avec le même ID;
- création indépendante pour le second utilisateur;
- suppression de la ligne courante tout en conservant l'historique de révisions.

Le script SQL est une transaction terminée par `ROLLBACK`; le conteneur est jetable de toute façon.

## Limites et recette navigateur restant à faire

Cette pile est PostgreSQL, pas le stack complet Supabase. Elle valide le vrai SQL/RPC, mais ne simule pas GoTrue, PostgREST, le Worker ou le navigateur Auth. La suite Node couvre les filtres/pagination, DTO et construction indépendante du brouillon avec aliments, ainsi que l'immuabilité des snapshots; elle n'exécute pas une session navigateur contre ces services intégrés.

Après disponibilité d'un environnement Auth/Worker local, vérifier manuellement :
1. Se connecter avec un compte synthétique; créer des repas confirmés à plusieurs dates et vérifier les 20 récents, la recherche accent-insensible et les bornes de date.
2. Enregistrer un modèle depuis un repas, le renommer, le reprendre dans un nouveau brouillon puis le supprimer; contrôler que les révisions restent archivées.
3. Reprendre un aliment et une recette; changer une quantité, vérifier le recalcul avec le catalogue/recette courant, puis confirmer. Comparer avant/après les snapshots d'origine.
4. Répéter avec deux comptes; vérifier l'isolation, l'annulation, le mode hors ligne et la resynchronisation.
5. Naviguer uniquement au clavier (dialogue de modèle, filtres, boutons de reprise) et vérifier les layouts PC et Android réel; cette recette n'a pas été exécutée par l'agent.

Aucune réussite locale n'est revendiquée par le présent document.
