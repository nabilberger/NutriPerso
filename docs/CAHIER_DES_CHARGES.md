# NUTRIPERSO
## Cahier des charges fonctionnel et technique — Version 1.0

**Document de référence destiné à Codex**

**Statut :** Spécifications validées pour la conception  
**Nature du projet :** Application personnelle évolutive  
**Plateforme :** PWA — ordinateur et smartphone Android

---

# 1. Présentation du projet

NutriPerso est une application personnelle de suivi nutritionnel et de gestion des habitudes alimentaires.

Son objectif est de fournir à son utilisateur un outil complet permettant de contrôler précisément son alimentation, ses apports nutritionnels, ses recettes, son poids et son évolution dans le temps.

L'application doit reproduire et améliorer les fonctionnalités utiles des applications nutritionnelles existantes, notamment :

- La saisie et l'analyse des repas.
- La reconnaissance des aliments à partir de photographies.
- Le calcul des calories et des macronutriments.
- La gestion des aliments et recettes personnelles.
- Le suivi du poids et des mensurations.
- L'historique alimentaire.
- Les statistiques et les bilans.
- L'assistance par intelligence artificielle.
- Les rappels et notifications.

NutriPerso est initialement destinée à un utilisateur unique, qui sera également son premier testeur fonctionnel.

**Principe directeur :** construire une application réellement utile au quotidien, simple à utiliser, fiable dans ses calculs et suffisamment bien structurée pour pouvoir évoluer vers un produit commercial sans reconstruction complète.

# 2. Philosophie et principes fondamentaux

Le développement doit respecter cinq principes essentiels.

### 2.1 Fiabilité nutritionnelle

Les calculs nutritionnels doivent être effectués par le moteur de l'application et non par le modèle d'intelligence artificielle.

Les valeurs nutritionnelles doivent provenir de sources identifiées et d'un catalogue structuré.

### 2.2 Assistance IA

L'intelligence artificielle intervient dans l'identification des aliments, l'analyse des photographies, l'estimation des quantités, l'interprétation des données et l'assistance à l'utilisateur.

Elle ne doit jamais être l'autorité finale pour les calculs nutritionnels.

### 2.3 Simplicité d'utilisation

L'interface doit privilégier la rapidité de saisie, la lisibilité et la facilité de consultation.

Éviter les fonctionnalités inutiles, les écrans surchargés et les manipulations répétitives.

### 2.4 Évolutivité

L'architecture doit permettre d'ajouter ultérieurement des fonctionnalités sans devoir réécrire le cœur de l'application.

### 2.5 Indépendance technologique

NutriPerso ne doit pas être prisonnière d'un hébergeur, d'une base de données, d'un service de stockage ou d'un fournisseur d'intelligence artificielle.

Les fournisseurs externes doivent être interchangeables grâce à des interfaces et adaptateurs clairement définis.

# 3. Fonctionnalités fonctionnelles

## 3.1 Journal alimentaire

Le journal alimentaire constitue le cœur de l'application.

Il doit permettre :

- La saisie manuelle d'un repas.
- L'ajout de plusieurs aliments dans un même repas.
- La définition des quantités et unités.
- La sélection d'une date et d'une heure.
- La modification et la suppression d'une saisie.
- L'ajout d'une photographie.
- La consultation des repas de la journée.
- La visualisation des totaux nutritionnels.

Catégories de repas configurables : petit-déjeuner, déjeuner, dîner, collation et autres.

La saisie manuelle doit rester possible indépendamment de la disponibilité de Gemini.

### 3.1.1 Réutilisation des repas

L’utilisateur doit pouvoir réutiliser rapidement des repas consommés précédemment ou enregistrer volontairement un repas comme modèle réutilisable.

Distinguer clairement :

- **Repas consommés** : enregistrements datés du journal, conservés dans l’historique avec leurs instantanés nutritionnels.
- **Repas récents** : les 20 dernières consommations proposées comme point de départ d’une nouvelle saisie; une recherche permet de retrouver les consommations plus anciennes. Elles restent des enregistrements historiques et ne deviennent pas des modèles du seul fait d’être récentes.
- **Modèles de repas enregistrés** : repas volontairement sauvegardés sous un nom choisi par l’utilisateur et disponibles pour des saisies futures.

Depuis un repas récent ou un modèle enregistré, l’utilisateur peut démarrer une nouvelle saisie. L’application préremplit sa composition et les portions initiales et utilise les valeurs nutritionnelles actuellement présentes au catalogue. L’utilisateur peut modifier directement le grammage de chaque portion sans reconstruire le repas ni rechercher de nouveau les aliments. Les valeurs nutritionnelles affichées sont recalculées immédiatement par le moteur déterministe de NutriPerso.

La nouvelle saisie est indépendante de son origine. Elle recalcule ses apports selon les valeurs actuellement présentes au catalogue. Sa modification ou sa validation ne modifie jamais le repas consommé d’origine ni son instantané nutritionnel historique, ni le modèle enregistré. Modifier un modèle ne modifie jamais les repas déjà consommés. Une saisie en cours à partir d’un modèle reste indépendante des modifications ultérieures apportées au modèle.

La réutilisation ne valide pas automatiquement un repas : l’utilisateur peut corriger la composition et les portions directement depuis le journal, puis enregistrer la nouvelle consommation selon le parcours normal. Les contrôles et actions doivent rester simples et rapides pour un usage quotidien. Aucun calcul nutritionnel n’est confié à l’IA.

## 3.2 Analyse des photographies

L'utilisateur peut capturer un repas depuis l'appareil photo ou sélectionner une image depuis la galerie/bibliothèque.

Déroulement attendu :

1. Sélection ou capture de la photographie.
2. Compression automatique avant transfert.
3. Transmission au backend.
4. Analyse par Gemini.
5. Identification des aliments et estimation des quantités.
6. Retour d'une réponse structurée et présentation à l'utilisateur.
7. Possibilité de corriger les aliments et quantités.
8. Validation du repas.
9. Calcul nutritionnel par le moteur de NutriPerso.

Aucune analyse IA ne doit être enregistrée comme repas définitif sans validation de l'utilisateur. Les estimations doivent être clairement identifiées comme telles.

La photographie est conservée pendant 30 jours après son analyse, puis supprimée automatiquement. L'utilisateur peut la supprimer manuellement à tout moment. La suppression d'une photographie ne supprime ni le repas associé ni ses données nutritionnelles; ceux-ci restent indépendants.

## 3.3 Catalogue alimentaire

Le catalogue doit permettre de rechercher, consulter et gérer les aliments.

Il comprendra :

- Nom de l'aliment.
- Catégorie.
- Source nutritionnelle.
- Valeurs nutritionnelles pour 100 g ou 100 ml.
- Unités et portions usuelles.
- Informations complémentaires utiles.

Les valeurs nutritionnelles doivent notamment couvrir :

- Énergie en kcal.
- Protéines.
- Glucides.
- Lipides.
- Fibres.

Le catalogue repose sur trois sources : USDA FoodData Central pour les aliments génériques; un catalogue local NutriPerso pour les aliments marocains et produits courants absents ou incomplets; et les aliments personnalisés créés/corrigés par l'utilisateur. Chaque aliment conserve sa provenance, son identifiant externe éventuel et sa date d'import/modification. Un import ne doit pas écraser silencieusement une fiche personnalisée. Les changements du catalogue ne modifient pas les instantanés des repas déjà consommés.

## 3.4 Moteur de calcul nutritionnel

Le moteur nutritionnel doit être déterministe et indépendant de Gemini.

Il doit calculer automatiquement les apports de chaque aliment selon sa quantité et ses valeurs nutritionnelles de référence.

Formule de référence :

Valeur nutritionnelle consommée = valeur pour 100 g × quantité consommée / 100.

Les calculs doivent être cumulés au niveau :

- De l'aliment.
- Du repas.
- De la journée.
- De la période sélectionnée.

Les recettes doivent utiliser le même moteur de calcul.

Les résultats doivent être reproductibles et testables.

Conserver une précision interne de 6 décimales et ne pas arrondir les valeurs intermédiaires. Afficher les calories en kcal à l’unité et les nutriments exprimés en grammes à 0,1 g, avec arrondi demi vers le haut.

## 3.5 Recettes personnelles

L'application doit proposer une bibliothèque de recettes.

Chaque recette comprend :

- Un nom.
- Une description facultative.
- Une liste d'ingrédients.
- Les quantités de chaque ingrédient.
- Le nombre de portions.
- Les étapes de préparation.
- Les valeurs nutritionnelles totales.
- Les valeurs nutritionnelles par portion.

Les valeurs nutritionnelles doivent être recalculées automatiquement lorsque les ingrédients ou les quantités changent.

Une recette doit pouvoir être ajoutée directement au journal alimentaire.

## 3.6 Suivi corporel

Prévoir la saisie et l'historique de :

- Poids.
- Tour de taille.
- Autres mensurations configurables ultérieurement.

Présenter les évolutions sous forme de graphiques et d'indicateurs lisibles.

Les données doivent être consultables par jour, semaine, mois et période personnalisée.

L'application ne doit pas imposer de variation quotidienne comme indicateur de réussite ou d'échec.

## 3.7 Historique et statistiques

L'utilisateur doit pouvoir consulter :

- Les repas précédents.
- Les apports nutritionnels journaliers.
- Les moyennes par période.
- L'évolution du poids.
- L'évolution des mensurations.
- Les recettes consommées.
- Les tendances alimentaires.

Les filtres doivent permettre de retrouver rapidement une journée ou une période.

Prévoir la possibilité d'exporter les données dans des formats standards, notamment CSV et JSON.

### Calendrier nutritionnel

Le journal alimentaire doit être consultable dans un calendrier interactif avec vues journalière, hebdomadaire et mensuelle, navigation entre les jours, semaines et mois, et sélection d’une journée pour ouvrir son journal détaillé.

Pour chaque journée, le calendrier présente les calories consommées, l’objectif calorique applicable à cette date, l’écart à cet objectif, une indication visuelle du niveau d’apport et l’état de saisie. Sans repas, la journée est « sans données ». Avec au moins un repas, elle est « complète » uniquement si l’utilisateur l’a explicitement marquée comme terminée; sinon elle est « partielle ». Le niveau visuel est bleu sous 90 % de l’objectif, vert de 90 % à 110 % inclus, et orange au-dessus de 110 %. Les moyennes caloriques d’une période excluent les journées sans repas. Le calendrier permet également de comparer les journées. Le détail journalier inclut les protéines, glucides, lipides et fibres.

L’objectif calorique est configurable et peut évoluer dans le temps. Chaque objectif s’applique à partir d’une date d’effet; un changement ultérieur ne modifie pas les objectifs des jours passés, sauf correction manuelle exceptionnelle de la date concernée.

Le calendrier et ses statistiques dérivent du journal alimentaire et des objectifs. Les totaux ne sont pas saisis séparément et ne doivent pas être stockés en double lorsque leur calcul fiable depuis les repas est possible.

## 3.8 Assistance intelligente

Gemini doit pouvoir exploiter les informations utiles disponibles dans NutriPerso :

- Repas enregistrés.
- Historique alimentaire.
- Recettes.
- Valeurs nutritionnelles calculées.
- Objectifs définis.
- Évolution corporelle.

Il doit pouvoir répondre aux questions de l'utilisateur, analyser ses habitudes, produire des bilans et formuler des suggestions.

Les données transmises au modèle doivent être sélectionnées selon la question posée afin d'éviter les transmissions inutiles.

Le contexte pertinent doit être récupéré depuis les données de NutriPerso à chaque interaction. Ne pas supposer que Gemini conserve automatiquement une mémoire permanente des conversations.

Les réponses de l'IA doivent distinguer les données enregistrées, les estimations et les recommandations.

Les conversations sont conservées dans NutriPerso pendant 7 jours après leur création, présentées dans une liste datée permettant de les retrouver et reprendre ou d'en démarrer une nouvelle. Elles sont supprimées automatiquement à l'expiration; l'utilisateur peut aussi les supprimer manuellement à tout moment. À chaque échange, l'application récupère le contexte nutritionnel utile depuis ses propres données et transmet au modèle uniquement le contexte pertinent. La continuité conversationnelle est gérée par NutriPerso; Gemini ne doit pas être considéré comme conservant une mémoire persistante.

## 3.9 Rappels et notifications

L'utilisateur peut créer des rappels personnalisables, notamment pour la pesée, la saisie des repas et d'autres besoins utiles. Il configure leurs horaires et fréquences et peut activer ou désactiver chaque rappel individuellement.

La V1 propose des notifications locales via les capacités PWA/navigateur, selon la prise en charge et les permissions accordées. Les rappels restent consultables dans l'application même si l'utilisateur refuse les notifications système. Un historique des rappels permet de retrouver les rappels prévus et leur état de présentation lorsqu'il est connu.

La simplicité et la fiabilité priment sur la multiplication des mécanismes de notification.

## 3.10 Configuration initiale et objectifs énergétiques

Au premier lancement, un formulaire obligatoire recueille l'âge, le sexe, la taille, le poids, le niveau d'activité physique, l'objectif pondéral et indique si l'utilisateur pratique le jeûne intermittent. Ces informations restent modifiables dans les paramètres.

L'objectif pondéral proposé est perte, maintien ou prise de poids. Le métabolisme de base est estimé avec Mifflin-St Jeor. Le niveau d'activité intervient dans l'estimation des besoins énergétiques et peut être inclus ou non via un interrupteur. La cible initiale est calculée selon l'objectif choisi, puis reste librement modifiable. Les calories dépensées lors d'exercices ne sont pas ajoutées automatiquement à l'objectif quotidien.

Chaque modification d'objectif calorique porte une date d'effet. Les objectifs appliqués aux jours passés restent inchangés lorsqu'un nouvel objectif est défini. Une correction manuelle exceptionnelle d'un objectif pour une date passée est autorisée.

## 3.11 Jeûne intermittent

La pratique du jeûne intermittent est demandée dans le formulaire initial. La configuration détaillée se trouve dans les paramètres afin de ne pas encombrer l'interface principale. L'utilisateur peut activer, désactiver ou suspendre librement le protocole.

La V1 propose des protocoles prédéfinis et personnalisés, avec des horaires quotidiens fixes et modifiables. Les horaires variables selon les jours sont réservés à une évolution ultérieure. L'utilisateur peut consulter l'historique du protocole.

Des notifications sont proposées à l'ouverture et à la fermeture des fenêtres de jeûne, selon les capacités et permissions PWA/navigateur. La configuration et l'historique restent accessibles dans l'application lorsque les notifications système sont refusées.

## 3.12 Export et suppression des données

L'utilisateur peut exporter les données structurées au format JSON et CSV : repas, historique nutritionnel, aliments personnels, recettes, mesures, profil, objectifs datés, conversations conservées, rappels et jeûne intermittent. Les photos et autres fichiers binaires sont fournis dans une archive ZIP séparée avec un manifeste reliant chaque fichier à son enregistrement. Une restauration complète doit reconstituer les données et fichiers associés.

L'utilisateur peut demander la suppression complète de ses données NutriPerso, notamment son profil et compte, historique, conversations, rappels, paramètres, fichiers et données locales synchronisées. Cette action exige une confirmation explicite avant exécution.


# 4. Fonctionnement hors connexion

La saisie, la modification et la suppression des repas restent possibles lorsque le backend est inaccessible. Les opérations sont conservées dans une file locale et synchronisées au retour de la connexion. Chaque opération possède un identifiant unique/idempotent.

Les demandes d'analyse IA créées hors connexion (contexte et photo éventuelle inclus) restent dans une liste « En attente » jusqu'à relance après reconnexion ou annulation par l'utilisateur. Aucune expiration automatique. Elles ne sont pas analysées ni enregistrées comme repas définitifs sans connexion et validation explicite.

Les repas enregistrés restent modifiables ou supprimables à tout moment. Une modification met à jour le repas et ses calculs/statistiques. Les instantanés nutritionnels ne changent pas lors d'une modification du catalogue ou d'une recette; ils sont recalculés lorsque l'utilisateur modifie explicitement le repas.

En cas de modifications concurrentes, la règle est « dernière modification confirmée = version conservée ». L'ordre est attribué par le serveur, pas par l'horloge du client. Une suppression confirmée est synchronisée comme suppression logique et prévaut sur toute ancienne copie. Aucun écran de résolution manuelle n'est prévu en V1.

L'analyse photo et l'assistance IA nécessitent une connexion.

## 4.1 Sauvegardes et restauration

Sauvegarde automatique quotidienne, conservation glissante de 30 jours et deux copies indépendantes : une dans l'environnement Supabase et une sur le serveur personnel de l'utilisateur. Une sauvegarde manuelle est disponible à la demande.

Les archives (base PostgreSQL restaurable, fichiers et manifeste d'intégrité) sont chiffrées avant transfert et stockage; la clé est conservée séparément. Les échecs doivent être signalés et une restauration complète testée périodiquement. Après restauration, les suppressions confirmées postérieures au point de sauvegarde sont rejouées afin qu'aucune donnée supprimée ne réapparaisse.


# 5. Architecture technique cible

## 5.1 Application cliente

PWA responsive, installable sur ordinateur et Android.

L'interface doit être indépendante du backend et communiquer avec lui par API.

Les technologies frontend seront proposées dans le document d'architecture technique, en privilégiant la stabilité, la maintenance et la simplicité.

## 5.2 Backend

Cloudflare Workers constitue le premier environnement d'exécution.

Le backend doit assurer :

- La sécurisation des clés API.
- Les communications avec Gemini.
- Les opérations métier nécessitant un traitement serveur.
- L'accès aux données.
- La gestion de la synchronisation.
- La validation des requêtes.
- La gestion des erreurs.

La logique métier ne doit pas être dispersée dans des fonctionnalités propriétaires de Cloudflare.

Le backend devra pouvoir être déplacé vers un VPS, un serveur Docker ou un autre cloud.

Prévoir une architecture compatible avec un déploiement Docker indépendant.

## 5.3 Base de données

Supabase PostgreSQL constitue la première solution.

Les données métier doivent reposer sur PostgreSQL standard.

Éviter les dépendances inutiles aux fonctions propriétaires de Supabase.

Prévoir :

- Migrations SQL versionnées.
- Structure relationnelle documentée.
- Identifiants stables.
- Contraintes d'intégrité.
- Sauvegardes et exports.
- Accès centralisé à la base.

L'application doit pouvoir migrer vers un autre hébergement PostgreSQL.

## 5.4 Stockage des fichiers

Supabase Storage constitue le premier fournisseur.

Créer une interface de stockage indépendante permettant de passer ultérieurement à un stockage compatible S3, Cloudflare R2 ou équivalent.

Ne pas disperser les appels spécifiques au fournisseur dans le code métier.

## 5.5 Intelligence artificielle

Gemini Flash est le premier fournisseur.

Créer une interface IA interne et un adaptateur propre à chaque fournisseur.

Les contrats d'entrée et de sortie doivent être définis par NutriPerso.

Le remplacement de Gemini par un autre modèle ne doit pas nécessiter une modification générale de l'application.

Prévoir la possibilité d'utiliser ultérieurement un modèle local.

## 5.6 Authentification

Pour la première version, une configuration simple adaptée à un utilisateur unique est suffisante.

Ne pas développer prématurément un système commercial multi-utilisateurs.

L'architecture devra néanmoins éviter les choix qui rendraient impossible l'ajout ultérieur de comptes et de permissions.

# 6. Portabilité et indépendance

Les éléments suivants doivent pouvoir être remplacés indépendamment :

| Composant | Fournisseur initial | Évolution possible |
|---|---|---|
| Frontend | Cloudflare Pages | Hébergement statique alternatif |
| Backend | Cloudflare Workers | VPS, Docker, cloud |
| Base de données | Supabase PostgreSQL | PostgreSQL standard |
| Stockage | Supabase Storage | S3, R2, autre |
| IA | Gemini Flash | OpenAI, autre API, modèle local |
| Authentification | Solution simple adaptée à la V1 | Fournisseur compatible OIDC |

La portabilité concerne en priorité le code, la logique métier, les configurations, les formats de données et les interfaces entre composants.

La migration commerciale des comptes utilisateurs et des historiques personnels n'est pas une exigence de la V1. Elle sera étudiée au moment d'un éventuel changement de modèle commercial.

# 7. Évolutivité commerciale future

NutriPerso est personnelle dans sa première phase.

Aucune fonctionnalité commerciale ne doit être développée prématurément.

Cependant, les fondations doivent permettre ultérieurement :

- Plusieurs utilisateurs.
- Des espaces de données séparés.
- Des rôles et permissions.
- Des fonctionnalités activables.
- Des formules d'abonnement.
- Des fonctions premium.
- Une administration centralisée.

La commercialisation nécessitera une étude spécifique de sécurité, de confidentialité, de conformité et de migration des données.

# 8. Sécurité et gestion des secrets

Les clés Gemini et autres secrets doivent rester exclusivement côté serveur.

Aucune clé privée ne doit être exposée dans le code frontend.

Prévoir :

- Variables d'environnement.
- Secrets séparés selon les environnements.
- Validation des données reçues par l'API.
- Gestion des erreurs sans exposition des secrets.
- Protection des accès à la base.
- Sauvegardes.
- Journalisation technique sans données personnelles inutiles.

Ne jamais inscrire de secret dans GitHub.

# 9. Qualité et maintenance

Le projet doit être maintenable par un développeur et compréhensible par Codex.

Exigences :

- Code modulaire et documenté.
- Nommage cohérent.
- Séparation des responsabilités.
- Tests unitaires du moteur nutritionnel.
- Tests des interfaces avec les fournisseurs.
- Tests des API.
- Gestion centralisée des erreurs.
- Migrations versionnées.
- Documentation de configuration et de déploiement.

Toute nouvelle fonctionnalité doit être accompagnée des tests pertinents.

Ne pas modifier plusieurs composants sans vérifier les effets sur les fonctionnalités existantes.

# 10. Ergonomie et expérience utilisateur

L'application doit privilégier :

- Une saisie rapide.
- Des informations nutritionnelles immédiatement visibles.
- Une navigation simple.
- Des graphiques lisibles.
- Une interface responsive.
- Une cohérence visuelle sur PC et Android.
- Des retours clairs sur les traitements et synchronisations.
- La possibilité de corriger facilement les données proposées par l'IA.

L'expérience quotidienne doit être prioritaire sur les effets visuels ou les fonctionnalités secondaires.

# 11. Périmètre de la première version

La première version fonctionnelle doit couvrir :

1. Journal alimentaire et saisie manuelle.
2. Analyse des repas par photographie.
3. Catalogue nutritionnel et calcul automatique des calories et macronutriments.
4. Gestion des recettes et réutilisation des repas récents/modèles enregistrés.
5. Suivi du poids et des mensurations.
6. Historique et statistiques, dont le calendrier nutritionnel interactif journalier, hebdomadaire et mensuel.
7. Assistance Gemini avec historique des conversations conservé 7 jours après leur création.
8. File d'attente et synchronisation.
9. Rappels configurables et notifications locales PWA/navigateur selon permissions.
10. Configuration initiale, objectifs énergétiques datés et jeûne intermittent configurable.
11. Export JSON/CSV et suppression complète avec confirmation explicite.
12. Interface PWA responsive.

Les fonctions commerciales, la gestion complexe de plusieurs comptes et les intégrations secondaires sont hors périmètre initial.

# 12. Critères de validation

La V1 ne sera considérée comme fonctionnelle que lorsque les conditions suivantes seront remplies :

- Un repas peut être saisi manuellement.
- Les 20 repas consommés les plus récents sont proposés; la recherche retrouve les plus anciens. Une réutilisation recalcule la nouvelle saisie avec les valeurs actuelles du catalogue sans modifier l’historique original.
- Un repas peut être enregistré sous un nom comme modèle, puis réutilisé sans altérer les repas consommés ni leurs instantanés historiques.
- Une photographie peut être analysée par Gemini.
- L'utilisateur peut corriger le résultat de l'analyse.
- Les calculs nutritionnels sont effectués par l'application.
- Les totaux du repas et de la journée sont cohérents.
- Une recette peut être créée et ajoutée à un repas.
- Le poids et les mensurations peuvent être enregistrés et consultés.
- L'historique est conservé.
- L'assistant conserve les conversations 7 jours, les supprime automatiquement à expiration et permet leur suppression manuelle; le contexte nutritionnel est rechargé depuis NutriPerso à chaque échange.
- Les rappels configurables apparaissent dans l'application sans permission système; les notifications locales sont utilisées lorsque le navigateur et les permissions le permettent.
- Le calendrier affiche les vues jour/semaine/mois, les apports, objectifs datés et écarts, les moyennes (en excluant les jours sans repas), les comparaisons et détails nutritionnels. Sous 90 % l’indicateur est bleu, entre 90 % et 110 % inclus vert, au-dessus de 110 % orange. Une journée est sans données sans repas, partielle avec repas non marquée terminée, et complète uniquement après marquage explicite par l’utilisateur. Les totaux proviennent du journal sans double saisie.
- Le formulaire initial est obligatoire, recueille les données personnelles et préférences prévues, et ces informations restent modifiables dans les paramètres.
- L'objectif énergétique tient compte de l'estimation Mifflin-St Jeor et du facteur d'activité activable/désactivable; aucune calorie d'exercice n'est ajoutée automatiquement. Les dates passées gardent leur objectif sauf correction manuelle exceptionnelle.
- Le jeûne intermittent peut être configuré, suspendu et consulté dans l'historique; les horaires V1 sont quotidiens et fixes, et les notifications de début/fin dépendent des permissions.
- Les données peuvent être exportées en JSON et CSV et supprimées intégralement après confirmation explicite.
- Les photos sont compressées avant transfert, supprimées automatiquement 30 jours après analyse ou manuellement, sans supprimer le repas ni ses apports.
- Le moteur conserve 6 décimales en interne; il affiche les kcal à l’unité et les nutriments en grammes à 0,1 g, arrondis demi vers le haut.
- Un conflit de synchronisation sur l’appareil principal est signalé sans écrasement silencieux.
- L'assistance IA peut exploiter les données enregistrées.
- Une saisie peut rester en attente en cas d'indisponibilité du backend.
- La synchronisation ne crée pas de doublons.
- L'application fonctionne sur PC et Android.
- Les clés API restent protégées.
- Les principaux composants externes sont isolés derrière des interfaces remplaçables.

# 13. Méthode de développement avec Codex

Codex doit travailler par étapes et ne pas générer l'ensemble de l'application en une seule opération.

Ordre de travail obligatoire :

**Étape 1 — Analyse et conception**
- Étudier le présent cahier des charges.
- Identifier les éventuelles ambiguïtés.
- Proposer l'architecture technique.
- Présenter les choix technologiques et leurs justifications.
- Identifier les risques de dépendance à un fournisseur.

**Étape 2 — Modèle de données**
- Concevoir les tables PostgreSQL.
- Définir les relations.
- Préparer les migrations.
- Définir les règles d'intégrité.
- Décrire les données nécessaires à chaque module.

**Étape 3 — Validation**
- Présenter les deux documents à l'utilisateur.
- Recueillir les corrections.
- Ne pas commencer le développement avant validation.

**Étape 4 — Initialisation**
- Préparer le dépôt.
- Structurer le code.
- Mettre en place les configurations.
- Préparer les environnements.
- Installer les dépendances nécessaires.

**Étape 5 — Développement progressif**
- Construire le socle.
- Développer les modules indépendamment.
- Tester chaque module.
- Valider les fonctionnalités au fur et à mesure.

**Étape 6 — Déploiement**
- Déployer progressivement.
- Configurer Cloudflare.
- Configurer Supabase.
- Configurer Gemini.
- Raccorder le domaine `nutri.brainboost3d.com`.

## Consigne finale à Codex

Ce cahier des charges constitue la référence fonctionnelle du projet.

Ne pas prendre d'initiative conduisant à réduire le périmètre ou à introduire une dépendance propriétaire sans la signaler.

Ne pas générer immédiatement le code de l'application.

La première mission consiste à produire :

1. Le document d'architecture technique.
2. Le document de conception du modèle de données.

Ces deux documents devront être cohérents avec le présent cahier des charges et soumis à validation avant toute implémentation.

Toute évolution future devra préserver les principes de fiabilité nutritionnelle, simplicité, évolutivité et indépendance technologique.

---

**Fin du cahier des charges — NutriPerso V1.0**