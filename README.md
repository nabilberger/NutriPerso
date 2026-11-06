# NutriPerso

Socle React responsive (Vite, TypeScript strict, PWA) et Worker Hono pour l’API USDA FoodData Central. Les secrets d’intégration restent côté Worker. L’adaptateur catalogue Supabase est serveur uniquement; aucune route publique d’import n’est exposée.

## Prérequis

- Node.js 20.19+ ou 22.12+
- npm

## Installation

```sh
npm install
```

## Développement local connecté

1. Copier `.dev.vars.example` vers `.dev.vars` à la racine et `.env.example` vers `.env`. Configurer `FDC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` et `SUPABASE_PUBLISHABLE_KEY` dans `.dev.vars`; configurer seulement `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` dans `.env`. `.dev.vars` et `.env` sont ignorés par Git.
2. Démarrer la pile complète en une commande :

```sh
npm run dev:stack
```

Le script vérifie les quatre noms de variables Worker dans `.dev.vars` sans afficher leurs valeurs, démarre Wrangler sur le port 8787, attend son écoute puis lance Vite. Si le Worker s’arrête, le proxy répond avec une explication et la commande de démarrage.

Pour lancer les processus séparément, ouvrez deux terminaux et exécutez `npm run worker:dev` puis `npm run dev`.


## Recette UI synthétique (sans services distants)

Pour parcourir Historique, les 20 repas récents, la recherche, les modèles, la navigation et la reprise dans le journal sans connexion Auth, Worker, Supabase ou USDA :

```sh
npm run dev:fixtures
```

Ce mode démarre Vite seul avec `VITE_NUTRIPERSO_UI_FIXTURES=1`. Il est réservé au développement, affiche un bandeau permanent et utilise des fixtures en mémoire. Les valeurs nutritionnelles d’exemple sont synthétiques et calculées par le moteur; elles ne décrivent aucun aliment réel. Créations, renommages, suppressions et brouillons disparaissent à la fermeture de la page. Le mode ne valide pas une session Auth réelle ni le transport Worker↔Supabase REST.

Un essai connecté nécessite un projet Supabase isolé avec la migration du lot #4 et un compte Auth de test. Wrangler exige `.dev.vars` avec `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` et `FDC_API_KEY`; le frontend utilise les valeurs publiques de `.env.local`. Le schéma Supabase de production n’a pas la migration du lot #4 : ne pas y tester ces écritures. La recette PostgreSQL locale vérifie uniquement les objets SQL et ne remplace pas un essai Worker/PostgREST/Auth.

## Authentification et routes personnelles

La connexion PWA utilise Supabase Auth (e-mail/mot de passe), restaure la session locale, traite les liens d’invitation et renouvelle les jetons. Il n’existe aucun formulaire d’inscription. Dans Supabase Auth, désactiver **Allow new users to sign up** et inviter les testeurs depuis le Dashboard ou un environnement administrateur de confiance.

Les routes `/api/private/*` exigent un access token Bearer. Le Worker le valide auprès de Supabase Auth sur chaque requête et dérive l’identifiant utilisateur de la réponse Auth vérifiée. Les routes de brouillons recettes/journal fournissent cet identifiant aux adaptateurs; tout identifiant utilisateur présent dans le JSON client est rejeté. Les erreurs d’accès à une ressource appartenant à un autre compte sont rendues comme `404` pour ne pas révéler son existence. La recherche et les fiches USDA restent publiques; le catalogue reste partagé.

`VITE_SUPABASE_PUBLISHABLE_KEY` est une clé publique destinée au navigateur. `SUPABASE_SECRET_KEY` ne doit être configurée que côté Worker et ne doit jamais être préfixée par `VITE_`.

## Routes USDA

- `GET /api/foods/search?q=lentils` retourne les résultats et nutriments fournis par la recherche USDA.
- `GET /api/foods/:fdcId` retourne la fiche et les nutriments disponibles, avec une sélection de l’énergie, protéines, glucides, lipides et fibres. Les valeurs et unités USDA sont conservées sans conversion.

En production, Wrangler route `nutri.brainboost3d.com/api/*` vers le Worker et laisse les autres chemins au site Pages. Les appels PWA restent relatifs (`/api/...`) : ils utilisent le domaine courant, sans URL d'API Vite ni configuration CORS. Le proxy Vite vers `127.0.0.1:8787` est réservé au développement local.

Configurer dans **Workers & Pages → nutri-perso-api → Settings → Variables and Secrets** les variables Worker `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY`, et les secrets Worker `FDC_API_KEY` et `SUPABASE_SECRET_KEY`. Les deux valeurs publiques `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` doivent être configurées séparément dans les variables d'environnement de build du projet Cloudflare Pages. Ne jamais définir `SUPABASE_SECRET_KEY` ou `FDC_API_KEY` avec le préfixe `VITE_`. La clé Supabase secrète contourne RLS; seul le code Worker de confiance peut l’utiliser.

Pour créer ou mettre à jour les secrets du Worker depuis le dépôt, Wrangler demande chaque valeur de façon interactive :

```sh
npx wrangler secret put FDC_API_KEY --config wrangler.jsonc
npx wrangler secret put SUPABASE_SECRET_KEY --config wrangler.jsonc
```

Les secrets ne sont pas stockés dans `wrangler.jsonc` ni transmis en argument de commande. Le routage configuré requiert que `brainboost3d.com` soit une zone Cloudflare accessible au compte de déploiement et que `nutri.brainboost3d.com` possède un enregistrement DNS proxifié existant.

## Vérifications et déploiement

```sh
npm test
npm run build
npm run worker:deploy
```

Le build TypeScript vérifie aussi les types du Worker. Les tests couvrent les réponses, unités, erreurs normalisées et l’absence de fuite de clé. Après le premier déploiement, vérifier dans Cloudflare que la route `nutri.brainboost3d.com/api/*` est active et que les quatre variables/secrets Worker sont configurés. Aucun réglage CORS n'est requis pour les appels PWA de même origine.

## Recette automatisée isolée

```sh
npx playwright install chromium --only-shell
npm run test:ui:fixtures
npm run test:integration:migrations
```

La suite navigateur démarre sa propre instance Vite synthétique sur `127.0.0.1:4180`, couvre ordinateur/mobile et refuse tout appel réseau `/api/`. Le test migrations utilise PostgreSQL jetable sans port exposé; il applique les sept migrations puis vérifie les contrats SQL journal/modèles. Les preuves et limites sont dans [le rapport de recette](docs/RECETTE_UI_AUDIT_20261106.md) et [le plan d’intégration](docs/AUDIT_INTEGRATION_20261106.md).
