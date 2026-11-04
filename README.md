# NutriPerso

Socle React responsive (Vite, TypeScript strict, PWA) et Worker Hono pour l’API USDA FoodData Central. Les secrets d’intégration restent côté Worker. L’adaptateur catalogue Supabase est serveur uniquement; aucune route publique d’import n’est exposée.

## Prérequis

- Node.js 20.19+ ou 22.12+
- npm

## Installation

```sh
npm install
```

## Développement local

1. Copier `.dev.vars.example` vers `.dev.vars` à la racine et `.env.example` vers `.env`. Configurer `FDC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` et `SUPABASE_PUBLISHABLE_KEY` dans `.dev.vars`; configurer seulement `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` dans `.env`. `.dev.vars` et `.env` sont ignorés par Git.
2. Dans un terminal, démarrer le Worker :

```sh
npm run worker:dev
```

3. Dans un second terminal, démarrer le frontend :

```sh
npm run dev
```

Vite relaie `/api/*` au Worker local sur le port 8787. L’interface existante n’appelle pas encore ces routes.

## Authentification et routes personnelles

La connexion PWA utilise Supabase Auth (e-mail/mot de passe), restaure la session locale, traite les liens d’invitation et renouvelle les jetons. Il n’existe aucun formulaire d’inscription. Dans Supabase Auth, désactiver **Allow new users to sign up** et inviter les testeurs depuis le Dashboard ou un environnement administrateur de confiance.

Les routes `/api/private/*` exigent un access token Bearer. Le Worker le valide auprès de Supabase Auth sur chaque requête et dérive l’identifiant utilisateur de la réponse Auth vérifiée. Les routes de brouillons recettes/journal fournissent cet identifiant aux adaptateurs; tout identifiant utilisateur présent dans le JSON client est rejeté. Les erreurs d’accès à une ressource appartenant à un autre compte sont rendues comme `404` pour ne pas révéler son existence. La recherche et les fiches USDA restent publiques; le catalogue reste partagé.

`VITE_SUPABASE_PUBLISHABLE_KEY` est une clé publique destinée au navigateur. `SUPABASE_SECRET_KEY` ne doit être configurée que côté Worker et ne doit jamais être préfixée par `VITE_`.

## Routes USDA

- `GET /api/foods/search?q=lentils` retourne les résultats et nutriments fournis par la recherche USDA.
- `GET /api/foods/:fdcId` retourne la fiche et les nutriments disponibles, avec une sélection de l’énergie, protéines, glucides, lipides et fibres. Les valeurs et unités USDA sont conservées sans conversion.

En déploiement, configurer `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` comme variables Worker, puis `FDC_API_KEY` et `SUPABASE_SECRET_KEY` comme secrets (`npx wrangler secret put <NOM>`). Fournir au build PWA `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`. Ne pas placer de secret de production dans le code, le frontend, ni dans un fichier suivi par Git. La clé Supabase secrète contourne RLS; seul le code Worker de confiance peut l’utiliser.

## Vérifications et déploiement

```sh
npm test
npm run build
npm run worker:deploy
```

Le build TypeScript vérifie aussi les types du Worker. Les tests couvrent les réponses, unités, erreurs normalisées et l’absence de fuite de clé.
