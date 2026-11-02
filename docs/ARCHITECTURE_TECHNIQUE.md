# Architecture technique — NutriPerso

**Statut :** architecture globalement validée; décisions complémentaires intégrées — quelques paramètres restent à valider  
**Référence :** `docs/CAHIER_DES_CHARGES.md` (version 1.0)  
**Périmètre :** architecture de la V1 et trajectoire de portabilité. Ce document ne définit ni schéma de données ni tables.

## 1. Principes retenus

- Le cœur métier est une bibliothèque TypeScript indépendante du navigateur, de Cloudflare et des fournisseurs.
- Le backend expose une API HTTP versionnée. Les adaptateurs d’infrastructure sont des bords remplaçables autour des cas d’usage.
- PostgreSQL standard est la source de vérité après synchronisation. Le navigateur conserve une file d’attente locale pour les écritures hors ligne.
- Les calculs de nutrition sont déterministes, effectués côté métier à partir de données nutritionnelles structurées et versionnées. Une IA ne fournit que des suggestions structurées à confirmer.
- L’application reste conçue pour une personne en V1; elle n’introduit ni facturation ni administration commerciale. Les opérations et entités sont toutefois conçues pour ne pas empêcher l’ajout futur d’un propriétaire de données et d’autorisations.
- La portabilité est obtenue par des contrats stables et des formats standards; elle n’implique pas que chaque service cloud ait un équivalent gratuit identique.

## 2. Technologies recommandées

| Domaine | Proposition | Motif et limites |
|---|---|---|
| Langage | TypeScript strict, avec types séparés entre domaine et transport | Partage des contrats et validation, tout en gardant les règles métier testables hors runtime. Éviter les types générés par un fournisseur dans le domaine. |
| Frontend | React + Vite + TypeScript, application SPA responsive | Écosystème stable, livraison de fichiers statiques sur Cloudflare Pages ou tout hébergeur statique, sans dépendance à un rendu propriétaire. La V1 n’exige pas le rendu serveur. |
| UI | HTML sémantique, CSS responsive et composants accessibles; bibliothèque légère seulement si elle réduit réellement le travail | Réduit le poids mobile et favorise une interface rapide. Ne pas verrouiller l’expérience dans une bibliothèque visuelle spécifique. |
| PWA | Web App Manifest, service worker, Workbox via intégration Vite PWA, IndexedDB via Dexie (choix confirmé) | Cache de l’application shell et stockage local structuré. Les opérations métier hors ligne sont explicitement mises en attente; les tâches IA ne peuvent pas être exécutées hors ligne. Vérifier le comportement d’installation et des notifications selon navigateur/OS. |
| État et appels API | TanStack Query pour état serveur et cache; état d’interface local simple | Distingue données serveur et état temporaire. IndexedDB reste la source de la file d’attente, pas le cache mémoire de la bibliothèque. |
| Backend initial | TypeScript sur Cloudflare Workers avec Hono comme couche HTTP/adaptateur | Choix confirmé pour la V1. Hono porte l’adaptateur HTTP; le code métier ne doit importer ni Hono ni les API `cloudflare:*`. |
| Backend portable | Même API et mêmes cas d’usage, empaquetables avec un serveur Node LTS (par exemple Fastify) dans Docker | La portabilité du domaine est forte; l’adaptateur HTTP/runtime et les liaisons aux services sont à remplacer et à configurer séparément. Il ne faut pas supposer qu’un Worker est exécutable tel quel dans un conteneur. |
| Base et accès | PostgreSQL standard; migrations SQL versionnées (outil à valider, proposition : Drizzle Kit ou migrations SQL explicites); accès centralisé dans un adaptateur repository | Sauvegardes logiques et migrations exportables. Limiter les extensions spécifiques à Supabase; SQL PostgreSQL standard d’abord. Supabase peut servir PostgreSQL et éventuellement ses services gérés sans devenir la couche métier. |
| Connexion Workers → PostgreSQL | Connexion TCP PostgreSQL via Cloudflare Hyperdrive, isolée dans l’adaptateur de base; en Docker, connexion directe/pooler PostgreSQL | Choix retenu pour Workers Free, sous réserve d’un test de connexion avec l’instance Supabase réelle. Hyperdrive est une intégration Cloudflare spécifique, mais l’interface repository et le pilote PostgreSQL ne le sont pas. La configuration change au départ de Cloudflare. Éviter de placer les requêtes dans les handlers. |
| Fichiers | Interface `ObjectStorage`; Supabase Storage d’abord; adaptateurs S3 compatibles (R2 ou autre) ensuite | Métadonnées et droits d’accès gérés par l’application; clés d’objet et URLs temporaires masquées derrière le contrat. Aucun URL Supabase persistant dans le domaine. |
| IA | Interface `AIProvider`; adaptateur Gemini Flash via API serveur et sortie JSON validée | Le contrat NutriPerso décrit tâches, entrées minimales et propositions typées. L’adaptateur traduit vers le fournisseur; les sorties sont validées et traitées comme incertaines. Nom exact de modèle et paramètres restent configurables. |
| Validation API | Schémas d’entrée/sortie versionnés (par exemple Zod dans l’adaptateur HTTP) | Refuser tôt les formes invalides; séparer DTO, objets métier et modèles SQL. Ne pas faire dépendre le domaine d’une bibliothèque de validation si une validation simple suffit. |
| Observabilité | Journaux structurés, identifiant de corrélation, mesures techniques sans contenu nutritionnel ou image | Facilite le diagnostic et le changement d’hébergeur. Politique de rétention et niveau de détail à valider. |

**Choix confirmés :** React + Vite + TypeScript, Dexie/IndexedDB, Hono sur Cloudflare Workers et Hyperdrive pour l’accès PostgreSQL depuis Workers Free, après test de connexion avec l’instance Supabase. L’outil de migrations reste à choisir. PostgREST demeure une solution de repli si le test Hyperdrive échoue, au prix d’une dépendance de transport Supabase.

## 3. Architecture générale et communications

```text
Navigateur / PWA
  ├─ UI React et cas d’usage client
  ├─ IndexedDB : cache utile + file d’opérations locales avec UUID/idempotency key
  ├─ Service worker : cache de l’application; déclenchement opportuniste de synchronisation
  └─ HTTPS → API NutriPerso versionnée
                  │
                  ├─ Authentification / validation / limites de requêtes
                  ├─ Cas d’usage applicatifs
                  │    ├─ Domaine : journal, recettes, catalogue, mesures
                  │    ├─ Moteur nutritionnel déterministe
                  │    └─ Préparation contrôlée du contexte IA
                  └─ Ports (interfaces)
                       ├─ Repository PostgreSQL → adaptateur Supabase/Hyperdrive
                       ├─ ObjectStorage → Supabase Storage
                       ├─ AIProvider → Gemini Flash
                       ├─ IdentityProvider → Supabase Auth (un compte V1)
                       └─ Clock / ID / journal technique
                       └─ adaptateurs ultérieurs Node/Docker et fournisseurs alternatifs
```

Le client ne contacte jamais Gemini avec une clé privée et ne se connecte pas directement à PostgreSQL. Il utilise l’API pour les écritures synchronisées, les lectures nécessitant le serveur, les transferts de fichiers et les demandes IA. Les actifs statiques et la shell PWA sont servis par Cloudflare Pages au départ; une origine statique alternative doit pouvoir les héberger.

### Configuration initiale et objectifs énergétiques

Au premier lancement, le formulaire obligatoire recueille âge, sexe, taille, poids, niveau d’activité physique, objectif pondéral et pratique ou non du jeûne intermittent. Le profil reste modifiable dans les paramètres. Le service métier estime le métabolisme basal selon Mifflin-St Jeor à partir de l’âge, du sexe, du poids et de la taille; il applique le facteur d’activité seulement si l’interrupteur dédié est actif (comportement comparable à PlateLens). L’objectif calorique personnel reste modifiable librement; l’activité sportive ne génère aucun ajout automatique à la cible quotidienne. Les objectifs sont datés et historisés : une modification ne réécrit pas le passé, sauf correction manuelle exceptionnelle ciblant une date passée.

### Réutilisation et séparation des repas

Le journal conserve les **repas consommés** comme enregistrements historiques immuables vis-à-vis des changements ultérieurs de catalogue, des modèles et des nouvelles saisies. La liste des **repas récents** expose les 20 dernières consommations et permet la recherche parmi les repas plus anciens; elle ne constitue pas un type de modèle distinct. Les **modèles enregistrés** sont des éléments réutilisables nommés volontairement par l’utilisateur.

Le cas d’usage « démarrer depuis un repas » copie la composition et les quantités initiales vers un brouillon indépendant. Le brouillon ne garde pas de lien modifiable vers le repas source ou le modèle : changer un aliment ou son grammage ne touche qu’au brouillon. Enregistrer une consommation crée un nouvel enregistrement et son propre instantané nutritionnel. Modifier un modèle n’a d’effet que sur les utilisations futures; les consommations existantes et les brouillons déjà créés ne changent pas.

La réutilisation copie composition et quantités dans un nouveau brouillon indépendant, puis résout les aliments vers leurs valeurs nutritionnelles actuellement présentes au catalogue. Le nouveau brouillon recalcule donc ses valeurs sur le catalogue courant; l’instantané du repas d’origine reste immuable. Le moteur nutritionnel déterministe est réutilisé pour recalculer les valeurs dès qu’un grammage change. Pour éviter tout écart entre affichage et validation, le calcul d’aperçu dans le navigateur doit employer les mêmes règles métier déterministes que le backend; le serveur recalcule et produit l’instantané canonique à la validation. Ces opérations peuvent être réalisées hors ligne dans un brouillon local, puis synchronisées avec les garanties d’idempotence déjà prévues. La provenance nutritionnelle est décidée : toute nouvelle saisie issue d’un repas récent ou d’un modèle est calculée à partir des valeurs actuelles du catalogue, tandis que l’historique original demeure inchangé.

### Parcours principaux

1. **Saisie manuelle en ligne :** le client valide les champs, envoie une commande avec identifiant stable; l’API valide, exécute le cas d’usage, recalcule les valeurs nutritionnelles à partir du catalogue, persiste et renvoie la représentation canonique.
2. **Saisie hors ligne :** le client place une commande complète et identifiée dans IndexedDB, affiche l’état « en attente », puis la rejoue quand la connexion revient. Le serveur applique l’idempotence. Une erreur métier non récupérable reste visible et demande une intervention. La V1 cible un appareil principal. En cas de modifications concurrentes, la dernière modification confirmée par le serveur devient la version de référence. Une suppression confirmée prévaut sur toute ancienne copie. Aucune résolution manuelle n'est demandée en V1.
3. **Photo :** l’utilisateur capture une image ou la choisit dans la galerie; le client la compresse automatiquement avant transfert. L’API l’envoie à Gemini via l’adaptateur IA, valide la sortie et renvoie une proposition, sans créer de repas définitif. Après correction et validation, l’application calcule les nutriments. La photo est supprimée automatiquement 30 jours après analyse, ou immédiatement sur demande; supprimer la photo ne supprime pas le repas ni son instantané nutritionnel.
4. **Recette :** ingrédients et quantités sont évalués par le même moteur que les repas. La recette possède une version courante modifiable. Lorsqu’une portion est ajoutée à un repas, cette consommation référence la version et les valeurs de cette recette à cet instant; modifier ensuite la recette ne change pas rétroactivement les portions consommées. L’IA ne remplace pas le moteur de calcul.
5. **Assistance :** le backend sélectionne uniquement les données pertinentes pour la question, construit un contexte limité, appelle le fournisseur, et retourne une réponse distinguant faits issus des données enregistrées, estimations et recommandations. Ne pas transmettre l’historique complet par défaut.

### Calendrier nutritionnel et agrégations

Le calendrier est une vue de consultation du journal, pas une source de données supplémentaire. Un cas d’usage de lecture agrège à la demande les instantanés des repas consommés par date et récupère l’objectif calorique applicable à cette date. Il renvoie les totaux journaliers, les écarts, le détail des macronutriments/fibres, les moyennes et comparaisons pour la période demandée et un état de saisie. Les journées sans repas sont exclues des moyennes. Une journée sans repas est « sans données »; avec au moins un repas elle est « complète » seulement si l’utilisateur l’a explicitement marquée terminée, sinon « partielle ». Les vues jour/semaine/mois partagent ces mêmes requêtes et règles. Aucun total journalier redondant n’est persisté : l’agrégation est calculée de façon déterministe depuis le journal. Une optimisation future ne devra pas introduire de cache persisté sans invalidation/reconstruction fiable.

Les objectifs énergétiques initiaux sont estimés à partir du métabolisme de base Mifflin-St Jeor; un facteur d’activité physique optionnel, commandé par l’interrupteur utilisateur, intervient dans l’estimation des besoins. L’objectif reste librement modifiable et aucune calorie d’exercice n’y est ajoutée automatiquement. Chaque changement prend effet à une date donnée, sans modifier les jours passés; un cas d’usage explicite permet une correction manuelle exceptionnelle d’une date antérieure. Le niveau visuel compare consommé à l’objectif : bleu sous 90 %, vert de 90 % à 110 % inclus, orange au-dessus de 110 %. L’interface ouvre le journal détaillé de la journée sélectionnée.

### Conversations de l’assistant

Les conversations et leurs messages sont conservés par NutriPerso pendant 7 jours, listés avec dates, repris ou supprimés manuellement à tout moment. Un traitement planifié supprime automatiquement les conversations à expiration. Le délai de 7 jours court à partir de la création de la conversation. À chaque envoi, le cas d’usage recharge la conversation côté NutriPerso et sélectionne de nouveau le contexte nutritionnel pertinent depuis le journal, les objectifs, recettes et mesures. Le fournisseur IA reçoit seulement les messages/contextes nécessaires à cet échange; il n’est pas la mémoire canonique. La rétention éventuelle côté fournisseur dépend de ses conditions et reste distincte de la rétention NutriPerso.

### Rappels et notifications

La V1 conserve les rappels personnalisés (pesée, saisie des repas et autres besoins utiles), horaires/fréquences, activation individuelle et historique dans NutriPerso. Les notifications locales navigateur/PWA dépendent de la permission et des capacités de la plateforme; les rappels restent accessibles dans l’application sans permission. Aucun service push serveur n’est prévu.

Le jeûne intermittent est configuré dans les paramètres, activable, désactivable et suspendable, avec protocoles prédéfinis ou personnalisés, horaires quotidiens fixes modifiables et historique. Les notifications locales sont proposées à l’ouverture et à la fermeture des fenêtres de jeûne selon permission/capacités. Les horaires différents selon les jours sont hors V1. Le fonctionnement lorsque l’application ou le navigateur est fermé n’est pas garanti par une PWA seule.

### Synchronisation

La V1 prévoit un appareil principal. La file client comprend au minimum un UUID/idempotency key, type de commande, charge utile, date de création, état, nombre de tentatives et dernière erreur exploitable. L’API conserve suffisamment d’information d’idempotence pour qu’une répétition retourne le résultat antérieur sans créer un doublon. Des tentatives avec délai progressif et aléa évitent les boucles agressives. La reprise repose sur le retour dans l’application, le lancement, le retour en ligne et une relance manuelle. Elle ne dépend pas de Background Sync lorsque le navigateur est fermé; aucune synchronisation fermée n’est promise. Les demandes IA différées restent en attente jusqu'à relance ou annulation explicite par l'utilisateur; elles n'expirent pas automatiquement.

## 4. Modules et frontières

### Backend

- **`domain`** : types et règles métier sans accès réseau, base, runtime ou fournisseur. Contient notamment unités, conversions explicitement définies, quantités, règles de calcul et agrégations.
- **`application`** : cas d’usage/commandes/requêtes (créer ou corriger une entrée, réutiliser un repas récent ou un modèle enregistré dans un brouillon indépendant, enregistrer/modifier un modèle, ajouter une recette, agréger le calendrier depuis le journal, gérer profil/objectifs datés/jeûne/rappels, poursuivre/supprimer des conversations, exporter/supprimer les données, synchroniser, rechercher un aliment, analyser une photo, répondre à une question). Dépend de contrats abstraits.
- **`ports`** : contrats repositories (profil, journal, catalogue, objectifs datés, jeûne, conversations, rappels), stockage objet, fournisseur IA, notifications locales, export/suppression et tâches planifiées, horloge, identifiants, journalisation et identité.
- **`adapters/http`** : routes, DTO, validation, traduction erreurs métier → réponses HTTP, versionnement API et limites de requête.
- **`adapters/postgres`** : SQL, transactions, mappings et migrations; seules ces fonctions accèdent au pilote SQL.
- **`adapters/storage`** : Supabase Storage, puis adaptateur S3/R2; gestion d’objets et URL temporaires.
- **`adapters/ai`** : Gemini; prompts versionnés, limites d’entrée, décodage strict, validation de sortie, timeouts et erreurs fournisseur.
- **`runtime/worker`** et **`runtime/node`** : assemblage des dépendances, secrets, démarrage et cycle de vie du serveur. Le domaine/application ne contiennent pas de conditions `if Cloudflare`.
- **`shared/contracts`** : schémas d’API et types sérialisables réutilisables; ne pas y placer des entités SQL ou secrets.

### Frontend

- **`app`** : initialisation, routage, navigation, gestion globale des erreurs et bootstrap PWA.
- **`features`** : journal et réutilisation des repas (récents, modèles enregistrés, brouillons indépendants), catalogue, recettes, suivi corporel, statistiques et calendrier nutritionnel, assistant et historique des conversations, rappels/notifications, configuration initiale, objectifs énergétiques, paramètres de jeûne et export/suppression, chacune avec écrans et actions propres.
- **`domain-client`** : règles métier partagées et calcul nutritionnel déterministe pour l’aperçu immédiat lors de la modification des portions; le serveur recalcule à la validation et demeure la source canonique.
- **`data`** : client HTTP, mapping de contrats, cache de lectures et orchestration de synchronisation.
- **`offline`** : dépôt IndexedDB, file d’attente, migrations locales, états de synchronisation et reprise.
- **`pwa`** : manifest, cache contrôlé de fichiers statiques et cycle de mise à jour du service worker.
- **`design-system`** : composants accessibles réutilisables, sans règles nutritionnelles ni accès API.

## 5. Contrats d’échange pour les fournisseurs

Les interfaces ci-dessous définissent les responsabilités, pas le code ni les structures de base de données. Le calendrier est une requête de lecture du journal; conversations et rappels nécessitent des ports applicatifs dédiés.

| Port | Responsabilités du contrat | Adaptateur initial / remplacement |
|---|---|---|
| `NutritionRepository` | Recherche/lecture d’aliments et valeurs/unités; 20 repas consommés les plus récents et recherche parmi les anciens; agrégations du journal par période sans persistance redondante des totaux; enregistrement explicite du marqueur de journée terminée; transactions explicites | PostgreSQL via Hyperdrive/Supabase, puis tout PostgreSQL standard. Le repository ne retourne pas d’objets Supabase. |
| `ProfileRepository` / `EnergyGoalRepository` | Lire/mettre à jour le profil et conserver les objectifs énergétiques avec dates d’effet; correction exceptionnelle d’une date passée | PostgreSQL standard; règles de calcul indépendantes du stockage. |
| `FastingRepository` | Gérer protocole activé/suspendu, horaires quotidiens, configurations prédéfinies/personnalisées et historique | PostgreSQL standard; horaires variables par jour hors V1. |
| `ConversationRepository` | Créer/lister/reprendre/supprimer conversations et messages; expiration automatique après 7 jours | PostgreSQL standard et tâche planifiée d’expiration. |
| `ReminderRepository` / `ReminderDelivery` | Gérer rappels, horaires/fréquences, état actif et historique; demander notification locale et normaliser permissions/états disponibles | PostgreSQL; adaptateur de notification navigateur/PWA, sans push serveur en V1. |
| `DataExport` / `DataDeletion` | Exporter en JSON et CSV les données structurées complètes avec manifeste et associations des fichiers; supprimer après confirmation profil/compte, données, fichiers, caches et sauvegardes contrôlées | Cas d’usage applicatifs coordonnant les repositories, IndexedDB et ObjectStorage. |
| `ObjectStorage` | `put`, `get`/URL de lecture temporaire, `delete` et suppression à échéance; métadonnées, contrôle type/taille et erreurs normalisées; aucun chemin fournisseur exposé | Supabase Storage, puis S3/R2. Une migration de fichiers copie les octets et remappe les clés. |
| `AIProvider` | Tâche déclarée (analyse d’image, assistance), historique de conversation fourni par NutriPerso et contexte explicitement sélectionné, sortie NutriPerso structurée, délai/limite, métadonnées d’usage, erreurs normalisées | Gemini Flash, puis autre API ou modèle local. La sélection des données et la validation restent dans l’application. |
| `IdentityProvider` / `CurrentActor` | Identité opaque et capacités/permissions nécessaires au cas d’usage; aucune dépendance au format JWT d’un seul fournisseur dans le domaine | Supabase Auth pour un seul compte utilisateur en V1; adaptateur isolé, remplaçable ultérieurement par un fournisseur OIDC. |
| `Clock` / `IdGenerator` | Heure UTC et identifiants uniques déterministes en test, standards en production | API runtime ou bibliothèque portable; pas d’horloge implicite dans les calculs. |
| `NutritionSourceImporter` (optionnel) | Import contrôlé d’un catalogue externe avec attribution de source et provenance conservée | Import USDA FoodData Central initial; le téléchargement et ses conditions d’utilisation sont isolés du journal quotidien. |

Les contrats IA doivent inclure un type de tâche, un schéma de réponse versionné, un statut d’incertitude et les éléments proposés avec quantités/unités accompagnées d’une confiance ou d’une mention d’estimation. Les réponses libres ne sont jamais interprétées comme commandes persistées. Une sortie malformée, une réponse tronquée ou un timeout donne une erreur normalisée, pas un repas partiel.

## 6. Moteur nutritionnel déterministe

- Utiliser une arithmétique décimale déterministe (ou des entiers mis à l’échelle), jamais des additions répétées de flottants binaires. Conserver les valeurs internes à 6 décimales et ne pas arrondir les valeurs intermédiaires.
- Canoniser les quantités massiques en grammes et les volumes en millilitres. Les conversions d’échelle (kg↔g, L↔ml) sont fixes et exactes. Aucune conversion générique g↔ml n’est permise : elle requiert une densité documentée propre à l’aliment ou à la préparation. Une portion/unité domestique (pièce, tasse, cuillère) requiert une équivalence explicite propre à l’aliment; si elle est absente, demander un poids/volume plutôt que d’inventer une conversion.
- Appliquer la formule `valeur de référence × quantité / 100` pour grammes/ml selon le type de référence et agréger les valeurs non arrondies.
- Arrondir une seule fois à l’affichage : kcal à l’unité et nutriments exprimés en grammes à 0,1 g, avec arrondi demi vers le haut. Les sommes et valeurs stockées gardent leur précision interne.
- À la validation d’un repas, conserver un instantané des quantités, unités, références nutritionnelles et apports calculés utilisés. Une modification ultérieure du catalogue ne recalcule pas les consommations historiques. Pour une portion de recette, conserver aussi la version consommée et son instantané nutritionnel; les modifications de recette ne réécrivent pas l’historique.
- Même moteur pour aliments, recettes, repas et totaux journaliers. Les apports dérivés d’une recette se rapportent au nombre de portions défini.

La précision et les règles d’arrondi sont actées. Les portions domestiques ont des équivalences explicites propres à chaque aliment; une conversion g/ml exige une densité documentée. Les nutriments V1 sont kcal, protéines, glucides, lipides et fibres. Les repas historiques restent immuables face aux changements du catalogue/recette, mais une modification explicite du repas recalcule et remplace son instantané.

## 7. Sécurité, confidentialité et configuration

- **Authentification V1 :** Supabase Auth avec un seul compte utilisateur. Son intégration est confinée à `IdentityProvider`; le domaine reçoit un acteur opaque et ne dépend ni des JWT ni des SDK Supabase. La validation de session et l’autorisation sont effectuées côté serveur pour chaque requête. L’adaptateur pourra évoluer vers OIDC sans réécrire les cas d’usage.
- **Autorisation :** contrôler côté serveur chaque opération et chaque objet; ne jamais faire confiance à un identifiant envoyé par le client. Prévoir une notion d’acteur/propriétaire dans l’architecture, sans concevoir aujourd’hui le schéma multi-utilisateur.
- **Secrets :** variables et secrets distincts par local/staging/production; gestionnaire de secrets Cloudflare ou variables de déploiement côté VPS. Aucun secret Gemini, stockage privilégié ou base dans le frontend, le dépôt, les journaux ou l’URL. Rotation et procédure de révocation documentées.
- **API :** HTTPS, validation stricte, limites de taille, types MIME et dimensions pour images, timeouts, limites de fréquence et quotas pour éviter l’abus IA. CORS limité aux origines réelles. Protection contre rejeu par idempotence; erreurs externes normalisées sans message sensible.
- **Base :** compte d’application au moindre privilège; séparer credentials de migration et d’exécution; TLS; transactions et contraintes PostgreSQL; sauvegarde et essai de restauration. Ne pas exposer le rôle service Supabase au navigateur.
- **Fichiers :** objets privés par défaut, accès temporaire, compression avant transfert, suppression automatique 30 jours après analyse et suppression manuelle immédiate. La suppression des photos ne supprime pas les repas ni instantanés nutritionnels. Supprimer les métadonnées EXIF non nécessaires et ne pas journaliser les images.
- **Données vers IA :** minimisation par question, absence d’identifiants directs non nécessaires et limite de contexte. Les conversations NutriPerso expirent sous 7 jours et sont supprimables manuellement; la rétention côté fournisseur demeure soumise à ses conditions.
- **Configuration :** mêmes noms de configuration logiques partout (URL DB, stockage, IA, origine publique, clés); adaptateurs assemblés par environnement. Les fichiers `.env.example` ne contiennent que des noms/valeurs fictives.
- **Données personnelles :** poids, mesures, habitudes, profil et photos sont sensibles dans la pratique; limiter rétention, accès et télémétrie. Export complet JSON/CSV; suppression complète après confirmation explicite, incluant compte/profil, données actives, fichiers, stockage local et copies de sauvegarde sous contrôle de NutriPerso; une restauration ne doit pas réintroduire les données supprimées. Les traces déjà transmises aux fournisseurs externes restent soumises à leurs politiques de rétention.

## 8. Déploiement, exploitation et migration

### V1 proposée

1. **Frontend :** build statique React/Vite déployé sur Cloudflare Pages, domaine `nutri.brainboost3d.com` selon la configuration prévue.
2. **API :** Worker séparé ou projet API attaché au déploiement; secrets par environnement. Éviter de mélanger le code source de l’interface au code métier serveur.
3. **Données :** Supabase PostgreSQL et Supabase Storage en région choisie explicitement. Accès SQL via adaptateur PostgreSQL/Hyperdrive; vérifier la compatibilité du plan et la configuration effective avant mise en service.
4. **IA :** Gemini Flash côté serveur; quotas et dépenses surveillés. En cas de panne IA, journal, recettes et saisie manuelle restent disponibles.
5. **Environnements :** local, préproduction, production séparés autant que possible; aucun test de migration destructive sur la production.

Cloudflare Workers Free annonce une limite de 100 000 requêtes/jour et 10 ms CPU par invocation sur la documentation consultée; Pages Functions suivent les quotas Workers. Supabase Free inclut actuellement 500 MB de base et 1 GB de stockage, mais les projets Free peuvent être mis en pause après une semaine d’inactivité et l’offre Free n’inclut pas les sauvegardes automatiques. Cela convient à l’expérimentation personnelle avec export et sauvegardes opérés séparément, mais n’offre pas une disponibilité de production garantie. Gemini API propose un niveau gratuit limité selon modèle et quotas; les limites et le traitement des données diffèrent du niveau payant. Revérifier ces paramètres au moment de créer les comptes, car ils changent. [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Cloudflare Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/), [Supabase pricing](https://supabase.com/pricing), [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).

### Trajectoire de migration

**Workers → Docker/VPS :** construire une image Node LTS qui assemble les mêmes cas d’usage, ports et adaptateurs PostgreSQL/Storage/IA. Remplacer runtime HTTP, secrets, santé, logs et connexion PostgreSQL; garder API versionnée, règles métier et contrats inchangés. Exécuter migrations, vérifier export/import et restauration, puis faire une bascule DNS/API après sauvegarde et validation. Les traitements de rétention différés (expiration des conversations après 7 jours et suppression des photos 30 jours après analyse) passent par un port de tâches planifiées, avec adaptateur Cloudflare Cron en V1 et ordonnanceur Node/Docker portable. Les rappels système restent locaux au navigateur/PWA; leur déclenchement en arrière-plan dépend de la plateforme.

**Supabase PostgreSQL → PostgreSQL standard :** exporter avec outils PostgreSQL (`pg_dump`/`pg_restore` ou réplication contrôlée), créer le serveur cible, appliquer migrations, importer et vérifier comptages/contraintes, puis basculer la configuration. Éviter dépendance à Auth/RLS/Edge Functions/Storage dans les règles métier; l’usage éventuel de Supabase Auth est isolé par le port d’identité. Les extensions PostgreSQL choisies doivent être portables ou listées comme prérequis.

**Supabase Storage → S3/R2 :** inventorier les objets via l’abstraction, copier les contenus et métadonnées, valider tailles/hash, conserver une table de correspondance de clés dans l’adaptateur, puis basculer les lectures/écritures. Éviter que l’URL du bucket soit une référence métier permanente.

**Gemini → autre fournisseur :** implémenter l’adaptateur contre le même contrat, tests de conformité sur les schémas et erreurs, comparer qualité/coût/latence sur des exemples consentis, basculer via configuration. Les prompts restent versionnés par adaptateur, les règles métier ne changent pas.

**Sauvegardes redondantes actées :** sauvegarde automatique quotidienne, rétention glissante de 30 jours, deux destinations (Supabase et serveur personnel) et sauvegarde manuelle. Chaque archive contient un export PostgreSQL cohérent, les fichiers et un manifeste (clés, tailles, empreintes). Chiffrement avant transfert, clé conservée séparément, signalement des échecs et test périodique de restauration complète. Les suppressions confirmées postérieures au point de sauvegarde sont rejouées après restauration.

## 9. Limites et coûts à anticiper

- Les quotas gratuits sont mouvants et peuvent inclure pauses, quotas journaliers ou absence de sauvegardes/garantie; prix nul ne signifie pas service toujours disponible. Coûts possibles : plan Supabase Pro, stockage/egress, Cloudflare paid, domaine, sauvegarde externe, SMTP/notifications, et usage IA payant.
- Les appels IA sur images et contextes longs sont les plus susceptibles de générer des frais. Réduire image et contexte, limiter tailles/fréquences, journaliser le nombre d’unités sans contenu, rendre les appels explicites, définir un budget/alerte et un mode sans IA.
- Hyperdrive retire une partie du coût de connexions répétées mais crée une dépendance d’exploitation Cloudflare et doit être validé selon le niveau de service/plans. Un VPS peut exiger gestion TLS, patchs, pare-feu, sauvegardes, supervision et disponibilité; le faible prix mensuel déplace l’effort vers l’exploitation.
- PWA hors ligne ne garantit pas l’exécution en arrière-plan quand le navigateur est fermé. Les notifications système nécessitent permission utilisateur, HTTPS et prise en charge réelle du navigateur; prévoir les rappels internes comme base fiable.
- La synchronisation offline soulève des conflits si le même enregistrement est modifié sur plusieurs appareils. La V1 vise un appareil principal; si plusieurs copies modifient le même enregistrement, la dernière modification confirmée par le serveur prévaut, y compris pour une suppression.
- La reconnaissance de portions depuis une photo reste une estimation visuelle difficile, dépendante de l’angle, des ingrédients cachés et des contenants. La correction et validation humaine sont obligatoires.
- Les formats nutritionnels et les équivalences de portion varient; les valeurs sources peuvent être incomplètes. La source et la provenance doivent accompagner les aliments importés/personnalisés.
- Le coût et les conditions d’usage de Gemini gratuit, notamment pour les données envoyées, doivent être vérifiés avant utilisation de vraies données personnelles. Le mode payant peut avoir des règles différentes.

## 10. Alternatives envisageables

| Sujet | Alternative | Avantages | Inconvénients |
|---|---|---|---|
| Frontend | Vue 3 + Vite | Léger, approche réactive simple, même possibilité PWA/statique | Écosystème et compétences potentiellement moins adaptés à l’équipe; migration ultérieure non gratuite si le choix est mal établi. |
| Frontend | SvelteKit | Très bon poids client, DX concise | Plus de spécificités de framework; ne justifie pas un rendu serveur pour le périmètre V1. |
| Backend | Fastify/Node dès le départ sur un VPS Docker | Même runtime que la cible portable; SQL direct et exploitation conventionnelle | Nécessite serveur et opérations dès la V1; moins aligné au déploiement initial Workers et coût/maintenance potentiels. |
| Backend | Cloudflare Workers + Hono (recommandé) | Déploiement léger, forte adéquation au frontend statique, offre gratuite utilisable à faible trafic | Runtime et limites propres, Hyperdrive et bindings à remplacer pour Docker; ne pas lier le domaine aux API Workers. |
| Backend | Supabase Edge Functions | Intégration pratique avec Supabase Auth/DB | Accentue la dépendance Supabase; trajectoire vers serveur portable moins directe que des ports indépendants. |
| Base | Supabase Postgres via API PostgREST | Facile à appeler depuis Workers, gestion REST disponible | API et policies spécifiques, logique/accès potentiellement dispersés, migration SQL et changement d’API plus complexes. |
| Base | PostgreSQL sur VPS dès V1 | Contrôle et portabilité opérationnelle | Gestion des sauvegardes, patchs, disponibilité et sécurité à charge de l’utilisateur. |
| Fichiers | Cloudflare R2 en premier | Compatibilité S3, peut réduire coût d’egress dans certains parcours | Ajouter un compte et une surface opérationnelle; ne résout pas les choix de confidentialité/rétention. |
| IA | API OpenAI ou autre | Modèles, vision et formats structurés alternatifs | Coût, qualité, disponibilité et règles de traitement différents; nécessite tests comparatifs et adaptateur distinct. |
| IA | Modèle local | Données potentiellement gardées sur infrastructure contrôlée et coût marginal d’API réduit | Besoin matériel/maintenance, latence, qualité variable, déploiement plus complexe; surtout une option future. |
| Auth | Supabase Auth / OIDC | Session et mécanismes standards, transition comptes possible | Configuration, secrets et règles de sécurité à traiter; ne pas intégrer directement à tous les modules. |
| Auth | Secret partagé à usage privé | Simplicité de mise en route | Rotation et partage délicats, risque si exposé; acceptable seulement derrière mécanisme serveur soigneusement protégé et à valider. |

## 11. Décisions actées et points restant à préciser

Décisions actées : sauvegardes quotidiennes chiffrées sur Supabase et serveur personnel, rétention 30 jours et sauvegarde manuelle; dernière modification confirmée conservée et suppression confirmée prioritaire; catalogue USDA + local + personnalisé; objectifs perte/maintien/prise calculés initialement par Mifflin-St Jeor et modifiables; demandes IA hors ligne conservées jusqu'à relance ou annulation; export JSON/CSV et fichiers en ZIP.

Restent à préciser : outil de migrations et séparation des environnements; validation Hyperdrive/Supabase; formats et taille maximale des photos; détails des portions et densités; processus d'import USDA; comportement du calendrier sans objectif; actions sur les modèles; unités des mesures; historique de jeûne/rappels; notifications app fermée; rétention des données chez Gemini.

L'architecture reste sans schéma ni tables SQL. Le modèle de données décrit séparément entités, relations, contraintes et instantanés métier.
