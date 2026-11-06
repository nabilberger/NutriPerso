# Traçabilité intégrale des exigences — NutriPerso V1

**Source unique des besoins :** [CAHIER_DES_CHARGES.md](./CAHIER_DES_CHARGES.md). Ce document suit l'exécution sans modifier, négocier ni diminuer les exigences. Les améliorations possibles seront traitées **après la conformité V1**. Les états indiqués restent prudents : un moteur testé ne constitue pas une interface opérationnelle.

**Lecture des états** : `Moteur` = logique/domaines existants ; `Code/preview` = écran ou API écrit mais pas encore validé de bout en bout ; `À réaliser` = exigence non livrée ; `À vérifier` = conformité non démontrée.

| Référence du cahier | Exigence à valider | Ticket(s) | État au 5 nov. 2026 |
|---|---|---|---|
| §2.1 / §3.4 | Calculs déterministes exacts, 6 décimales internes, arrondis affichage, inconnus ≠ zéro | #3, #5 | Moteur et tests existants ; parcours UI à réaliser |
| §3.1 | Journal, aliments, quantités, horaire, édition, suppression, totaux et photos optionnelles | #3 | Moteur + persistance existants ; UI à réaliser |
| §3.1.1 | 20 repas récents, recherche historique, modèles nommés, reprise indépendante avec nouvelles valeurs | #4 | À réaliser |
| §3.2 | Photo caméra/galerie, compression, Gemini, correction, validation humaine, suppression 30 jours | #6 | À réaliser |
| §3.3 | Catalogue USDA/local/personnel, provenance, unités, portions, valeurs nutritionnelles | #5, #2 | USDA intégré partiellement ; catalogue personnel à réaliser |
| §3.5 | Recettes complètes (création, édition, ingrédients, calcul, consommation) | #5 | Moteur/persistance et bibliothèque de lecture en preview |
| §3.6 | Poids et mensurations, courbes, corrections | #8, #2 | Poids UI/API en preview + table créée ; mensurations à réaliser |
| §3.7 | Historique, statistiques, jours sans données, journées partielles/complètes | #4, #10 | À réaliser |
| §3.7 Calendrier | Jour/semaine/mois, cibles datées, seuils bleu <90 %, vert 90–110 % inclus, orange >110 %, moyennes excluant jours vides | #10 | À réaliser |
| §3.8 | Coach Gemini, accès aux données actuelles, historique de conversations, rétention 7 jours et suppression manuelle | #6, #11 | À réaliser |
| §3.9 | Rappels configurables internes, notifications si permissions accordées | #8 | À réaliser |
| §3.10 | Configuration initiale obligatoire, calcul Mifflin-St Jeor, facteur d'activité facultatif, cibles datées, ajustement manuel, aucune calorie exercice auto | #9, #2 | Profil incomplet en preview ; objectifs à réaliser |
| §3.11 | Jeûne quotidien configurable, suspendable, historique, notifications conditionnelles | #8, #9 | Préférences horaires en preview ; protocole/historique à réaliser |
| §3.12 | Export JSON/CSV, suppression complète confirmée | #12 | À réaliser |
| §4 | Brouillons offline, file d'attente, idempotence, résolution serveur, tombstones | #8, #3 | Règles de persistance partielles ; synchronisation offline à réaliser |
| §4.1 | Sauvegardes deux destinations, restauration vérifiée, rétention et suppression cohérente | #12 | À réaliser |
| §5.1 | PWA PC/Android responsive, appareil photo, installation, service worker | #2, #7, #8 | PWA et responsive en place partiellement ; QA mobile à faire |
| §5.2–5.6 | Backend/DB/fichiers/Gemini/Auth, composants interchangeables | #2, #5, #6 | Cloudflare/Supabase/Auth opérationnels ; fichiers/Gemini à réaliser |
| §6 | Portabilité et indépendance fournisseur | #2, #6, #12 | À vérifier avant chaque intégration |
| §7 | Évolutivité future sans complexification commerciale V1 | #2 | Hors périmètre fonctionnel V1, contrainte architecturale |
| §8 | Secrets, accès par utilisateur, protection des données | #2, #6, #12 | Auth/RLS et secrets existants ; audit transversal requis |
| §9 | Tests, contrôle qualité, maintenance, build et déploiement | #2 et chaque ticket | CI GitHub existante ; E2E requis |
| §10 | Ergonomie rapide, composants Figma, PC et mobile | #7, #2 | Design initial en preview ; travail Figma à faire |
| §11 | **Les 12 éléments de la V1** | #2–#12 | Aucun feu vert V1 tant que chaque critère n'est pas testé |
| §12 | **Tous les critères de validation** | Chaque ticket référencé | Validation de bout en bout requise |
| §13 | Développement séquencé avec Codex, architecture/modèle validés, intégration progressive | #2–#12 | Architecture/modèle déjà documentés ; progression par tickets |

## Règle stricte de contrôle de couverture

- Chaque ticket doit citer la section exacte du cahier des charges et couvrir **tous les critères associés**, pas seulement son titre.
- Pour chaque ticket, séparer les états : `Spécifié`, `Implémenté`, `Testé CI`, `Testé E2E`, `Déployé`, `Accepté`.
- Aucune exigence du §11 ou critère du §12 n'est supprimé parce que sa mise en œuvre semble difficile ou parce qu'un écran est déjà élégant.
- Les améliorations UX ou fonctions modernes peuvent être proposées séparément, jamais en remplacement de l'élément initial.
- Au bilan de chaque lot, ChatGPT met à jour cette matrice et identifie explicitement les éléments restant à couvrir.
- **Pas de mention « V1 terminée »** sans preuve d'essai pour chacune des lignes concernées.

## Prochaine séquence de livraison

1. Stabiliser le ticket #2 sur PR #1 : menu utilisateur et profil, CSS, intégration Worker, tests.
2. Codex réalise #3 (Journal complet) avec accès au cahier des charges et aux modules existants.
3. Codex réalise #9 (configuration et objectifs) pour alimenter les calculs d'écart.
4. Codex complète #4, #5 puis #10 ; Gemini #6/#11 ; enfin #8/#12.
5. Le chantier Figma #7 suit les mêmes écrans et fournit la base de composants, sans requalifier les besoins.

**Les changements de méthode ne modifient en rien le cahier des charges.**

## Livraison Lot 3 — recettes (branche dédiée depuis 20630e79)

Éditeur de recettes, métadonnées, quantités/unités, portions, poids final facultatif,
confirmation serveur, bibliothèque, archivage et réutilisation indépendante dans le
journal : codés, avec tests Worker, PostgreSQL isolé et navigateur ordinateur/mobile.
Voir `LOT3_RECETTES_CATALOGUE.md` et les résultats de la PR pour le SHA validé et la CI.
Les ingrédients USDA et ceux du catalogue local/personnel existant sont utilisables.
L'édition/création de fiches alimentaires et des équivalences alimentaires reste à
réaliser au titre du §3.3 ; cette livraison ne clôt pas à elle seule #5 ni la V1.
État de déploiement : aucun nouveau Worker/Pages ni aucune migration distante appliqués.
