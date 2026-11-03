# NutriPerso

Socle React responsive (Vite, TypeScript strict, PWA) et Worker Hono pour l’API USDA FoodData Central. Les clés d’API restent côté Worker. Aucun catalogue local ni stockage Supabase n’est inclus.

## Prérequis

- Node.js 20.19+ ou 22.12+
- npm

## Installation

```sh
npm install
```

## Développement local

1. Copier `.dev.vars.example` vers `.dev.vars` à la racine. Remplacer la valeur de démonstration par votre clé Data.gov lorsque disponible. `.dev.vars` est ignoré par Git.
2. Dans un terminal, démarrer le Worker :

```sh
npm run worker:dev
```

3. Dans un second terminal, démarrer le frontend :

```sh
npm run dev
```

Vite relaie `/api/*` au Worker local sur le port 8787. L’interface existante n’appelle pas encore ces routes.

## Routes USDA

- `GET /api/foods/search?q=lentils` retourne les résultats et nutriments fournis par la recherche USDA.
- `GET /api/foods/:fdcId` retourne la fiche et les nutriments disponibles, avec une sélection de l’énergie, protéines, glucides, lipides et fibres. Les valeurs et unités USDA sont conservées sans conversion.

Clé en déploiement : `npx wrangler secret put FDC_API_KEY`. Ne pas placer de clé de production dans le code ni dans un fichier suivi par Git.

## Vérifications et déploiement

```sh
npm test
npm run build
npm run worker:deploy
```

Le build TypeScript vérifie aussi les types du Worker. Les tests couvrent les réponses, unités, erreurs normalisées et l’absence de fuite de clé.
