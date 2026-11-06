# NutriPerso — Organisation de réalisation

> **Document opérationnel, distinct des spécifications.** Le cahier des charges `docs/CAHIER_DES_CHARGES.md` reste la référence contractuelle et ne doit pas être modifié implicitement. Les décisions fonctionnelles existantes s'appliquent. En cas de contradiction, le cahier des charges prime : ouvrir une question de décision avant d'implémenter.

## 1. Mission et rôles

| Responsable / outil | Responsabilité | Livrable vérifiable |
| --- | --- | --- |
| Propriétaire du produit | Arbitrage des objectifs métier, validation des parcours, recette finale | Décisions sur les points bloquants, validation d'une démonstration complète |
| ChatGPT — chef de projet / architecte | Découper le cahier des charges en tickets, critères d'acceptation, dépendances ; superviser les changements, relire les PR et administrer GitHub, Supabase, Cloudflare via MCP | Tickets prêts pour Codex, revue des changements et rapport de déploiement |
| Codex — implémentation | Développer React, Worker, adaptateurs, migrations versionnées, tests, documentation technique ; faire un commit/PR par lot cohérent | Code et tests autonomes, build reproductible, PR avec preuves |
| Figma — UX/UI | Frames Desktop (1440), tablette (768) et mobile (390), design system, Auto Layout, composants et variantes, interactions de prototype et correspondance avec React | Fichier Figma versionné par itération et fiche de composants |
| GitHub | Source de vérité du code et des tickets ; CI et revue par PR | Branches, issues, checks et historique |
| Supabase | Stockage de données, Auth et RLS ; migrations appliquées après vérification | Schéma et droits validés |
| Cloudflare | Pages et Worker, prévisualisations et contrôles de déploiement | Staging testé puis production publiée |

### Interventions et autorisations

Les outils MCP connectés peuvent être utilisés par ChatGPT sans demander de captures d'écran pour les vérifications techniques accessibles. Une disponibilité effective doit être vérifiée avant d'annoncer un résultat. Codex local n'est pas directement pilotable depuis cette conversation : la transmission se fait par tickets GitHub précis et par sessions Codex lancées dans l'environnement de développement ; ne pas prétendre qu'une tâche lui a été exécutée sans preuve.

## 2. Source de vérité

1. `docs/CAHIER_DES_CHARGES.md` : besoin, parcours et engagements fonctionnels **intangibles sans décision explicite**.
2. `docs/ARCHITECTURE_TECHNIQUE.md` et `docs/MODELE_DONNEES.md` : architecture et modèle cible à relier à l'implémentation existante.
3. GitHub Issues : planification, critères d'acceptation, questions et dépendances.
4. GitHub PR + tests : implémentation ; Figma : design et comportement d'interface.
5. Ce document : méthode de travail uniquement ; il ne change aucune fonctionnalité contractuelle.

Aucun texte « à venir » ou élément factice ne doit être présenté comme fonctionnalité opérationnelle. Ne jamais créer des apports nutritionnels fictifs pour remplir un écran.

## 3. Cadence — peu de va-et-vient

- **Un ticket = un résultat utilisateur vérifiable.** Contient référence aux sections du cahier des charges, dépendances, cas limites, tests et captures attendues.
- ChatGPT prépare un **lot cohérent de tickets** ; Codex travaille sur une branche courte par ticket ou sous-ensemble dépendant, livre PR + tests.
- ChatGPT vérifie automatiquement les checks GitHub, les différences, la conformité aux spécifications, la cohérence Supabase/Worker, puis centralise les éventuels problèmes dans **une seule revue consolidée** ; pas de micro-instructions successives.
- Le propriétaire intervient principalement à la démonstration d'un parcours complet, et sur des choix produit réellement ambigus.
- Après validation technique, migration DB, déploiement Worker, puis Pages ; vérifier l'API et le parcours complet avant d'annoncer « terminé ».
- Conserver `main` stable ; PR de preview séparée ; ne pas fusionner une branche avec des dépendances backend manquantes.

## 4. Definition of Ready

Un ticket est prêt quand il contient : le but, le parcours utilisateur, la section de cahier des charges, les données nécessaires, les endpoints/contrats, les contrôles d'accès, les conditions de réussite, les tests, les dépendances, et le rôle Figma/Codex.

## 5. Definition of Done

Une tâche est **terminée** seulement si :
- Fonctionnalité accessible depuis l'interface, pas simplement présente dans un module.
- APIs, données, RLS, calcul exact et scénarios d'erreurs intégrés et testés lorsque concernés.
- Tests `npm test`, build `npm run build` et checks CI réussis.
- Responsive PC/mobile, états chargement/vide/erreur, clavier/accessibilité élémentaire.
- Vérification du parcours utilisateur de bout en bout sur un environnement raccordé au bon Worker et à la DB de test/production selon phase.
- Documentation technique/README mise à jour si nécessaire, PR revue et état de déploiement identifié.
- Aucune modification involontaire des exigences ou de données historiques.

Les étapes `codé`, `testé`, `déployé`, `validé utilisateur` doivent être distinguées.

## 6. Ordre de réalisation

**Lot 0 — Stabiliser la branche actuelle.** Prévisualisation / PR en brouillon, menu utilisateur, profil/photos, bibliothèque recettes, recherche catalogue et suivi du poids ; vérifier styles manquants, tests, migrations, dépendances Worker et intégration.

**Lot 1 — Journal nutritionnel utilisable.** Sélection de date, 1–3 repas configurables, aliments, quantités, calcul exact, confirmation, correction/annulation, rechargement, états vides, reprise hors ligne.

**Lot 2 — Historique et réutilisation.** 20 repas récents, recherche, modèles volontaires, édition des grammages, indépendance du brouillon et immutabilité de l'historique.

**Lot 3 — Recettes et catalogue.** Création, édition, confirmation et consommation de recettes, aliments personnels/localisés, unités et portions validées.

**Lot 4 — Photos, Gemini, Coach IA.** Compression, stockage 30 jours, estimation explicitement corrigible et validation humaine ; budgets, secrets backend, contexte, prompts et sorties structurées.

**Lot 5 — Suivi étendu, réglages, exports et PWA.** Poids/mensurations, graphiques, jeûne et notifications, CSV, offline/sync, sauvegarde et finalisation mobile.

**Lot UX/UI parallèle — Figma.** Concevoir et tester composants (navigation principale, menu compte depuis avatar, listes, formulaires, graphiques, feedback), puis appliquer progressivement ; accent vif maîtrisé, sans retarder les fonctions principales.

## 7. Conventions

- Branches : `feat/<ticket>-<nom>`, `fix/<ticket>-<nom>`, `design/<nom>`.
- PR : référence à l'issue, périmètre, critères couverts, résultats tests/CI, captures, impact DB/Worker/Pages, mode de vérification.
- Éviter les PR monolithiques mêlant design, migrations et plusieurs grands écrans.
- État des tâches : `À cadrer → Prêt Codex → En cours → À revoir → Validé techniquement → Déployé → Validé utilisateur`.
- Les secrets restent côté Worker, les clés publiques côté frontend selon configuration, le modèle nutritionnel déterministe reste seul maître des calculs.

## 8. Suivi du chantier actuel

La PR #1 est une **branche d'intégration expérimentale**, pas un lot de production prêt à merger. Plusieurs fichiers de fonctionnalités ont été ajoutés progressivement ; les endpoints de profil et mesures et les nouvelles tables doivent être cohérents avec le Worker déployé. Le menu compte a reçu un changement React dont le CSS doit encore être vérifié. Il faut terminer le lot 0, puis répartir les prochains tickets selon les lots ci-dessus.
