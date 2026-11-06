# Instructions Codex — NutriPerso

**Priorité absolue :** exécuter intégralement `docs/CAHIER_DES_CHARGES.md` (V1), sans le modifier, sans réduire le périmètre et sans réinterpréter les décisions déjà validées.

## Avant chaque tâche
1. Lire `docs/CAHIER_DES_CHARGES.md`, particulièrement les sections et critères concernés.
2. Lire `docs/ORGANISATION_PROJET.md` et `docs/TRACABILITE_EXIGENCES_V1.md`.
3. Lire le ticket GitHub assigné et les modules actuels ; ne pas réécrire des fonctionnalités déjà présentes.
4. Vérifier les dépendances et l'état des migrations Supabase / routes Worker nécessaires.

## Règles de développement
- Un lot / ticket fonctionnel à la fois, sur branche dédiée ; PR petite et revue.
- Calculs nutritionnels réalisés **exclusivement** par le moteur déterministe de NutriPerso. Respecter les fractions exactes, les valeurs inconnues, l'arrondi et les snapshots historiques immuables.
- Supabase Auth + contrôle de session côté Worker ; ne jamais utiliser un identifiant utilisateur fourni par le frontend comme source d'autorité.
- Aucun chiffre nutritionnel fictif, aucune confirmation de repas sans validation utilisateur.
- Responsive PC et Android, interactions clavier, états vide / chargement / erreur, expérience rapide.
- Rappels, dates, rétention, objectifs, synchronisation et sauvegardes conformes au cahier des charges.
- Isoler fournisseurs externes ; garder les secrets côté Worker.
- Les documents fonctionnels ne changent qu'après décision explicite de l'utilisateur ; les documents de suivi peuvent être mis à jour pour refléter le réel.

## Livrable Codex attendu
- Résumé des changements réels, fichiers modifiés, preuves de tests.
- `npm test && npm run build` exécuté dans un environnement Linux approprié et vérifié par GitHub Actions.
- Tests de régression couvrant invariants et scénarios d'erreurs.
- Indication explicite des migrations et des variables nécessaires.
- Indication claire des couches : codé / CI réussi / API déployée / fonction testée de bout en bout.
- Ne pas présenter « prêt en production » sans déploiement Worker/Pages cohérent et essai utilisateur.
- Remettre un compte rendu structuré permettant à ChatGPT de faire la revue technique et d'administrer GitHub, Cloudflare et Supabase.

## Prochaines étapes
- Stabiliser #2 (menu utilisateur, profil et poids, intégration de PR #1).
- Développer #3 (Journal alimentaire complet), puis #9 (configuration initiale et objectifs datés).
- Continuer selon la matrice de traçabilité V1 ; ne sauter aucune exigence des §11–12.
