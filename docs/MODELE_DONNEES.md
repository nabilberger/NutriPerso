# NUTRIPERSO — Modèle de données V1.0

**Statut :** proposition logique à valider avant toute migration SQL.  
**Base :** PostgreSQL standard, Supabase au premier déploiement.  
**Périmètre :** application personnelle, un utilisateur en V1.

## 1. Principes

- Identifiants UUID, clés étrangères et contraintes PostgreSQL standard.
- Dates techniques en UTC; dates locales interprétées selon le fuseau IANA du profil.
- Pas de stockage redondant des totaux journaliers calculables depuis les repas.
- Les repas confirmés conservent un instantané nutritionnel. Les changements de catalogue/recette ne modifient pas l'historique.
- Une modification explicite d'un repas recalcule ses apports et remplace son instantané. Une suppression confirmée est synchronisée comme suppression logique.
- Précision interne 6 décimales; affichage kcal entier et nutriments grammes à 0,1 g, arrondi demi vers le haut.
- Les suggestions IA ne deviennent pas des repas sans validation explicite.
- Les fournisseurs restent isolés derrière des adaptateurs.

## 2. Entités

| Domaine | Entités |
|---|---|
| Profil/objectifs | user_profile, energy_goal |
| Catalogue | food_source, food_item, food_nutrient, food_portion |
| Journal | meal, meal_item, meal_day_status |
| Modèles/recettes | meal_template, meal_template_item, recipe, recipe_ingredient |
| Mesures | body_measurement |
| Fichiers | media_asset |
| IA | ai_request, conversation, conversation_message |
| Rappels/jeûne | reminder, reminder_event, fasting_protocol, fasting_history |
| Synchronisation | sync_operation, record_tombstone |
| Sauvegardes/export | backup_run, backup_manifest_item, export_run |

## 3. Profil et objectifs

### user_profile
Une ligne active en V1. Champs : id UUID PK, age_years, sex_for_formula (valeur contrôlée Mifflin-St Jeor), height_cm numeric(7,2), activity_level, use_activity_factor boolean, timezone (IANA, ex. Africa/Casablanca), created_at, updated_at. Le poids courant est dérivé de la dernière mesure valide.

### energy_goal
Champs : id UUID PK, goal_type (lose, maintain, gain), target_kcal numeric(12,6), effective_from date, effective_to date nullable (fin exclusive), calculation_method (Mifflin-St Jeor/manual), activity_factor_applied boolean, created_at, updated_at. Les périodes d'effet ne se chevauchent pas. Cible initiale calculée selon profil, activité et objectif, librement modifiable; correction passée explicite et auditée.

## 4. Catalogue alimentaire

### food_source
Référentiel : USDA_FDC, LOCAL_CATALOG, USER_CUSTOM. Champs : id UUID PK, code unique, label, source_url nullable, created_at.

### food_item
Champs : id UUID PK, source_id FK, external_id nullable, name, normalized_name, category nullable, reference_basis (per_100g/per_100ml), is_user_editable, is_active, provenance JSONB, created_at, updated_at. Un identifiant externe est unique dans sa source. Le catalogue regroupe USDA, aliments locaux (notamment marocains) et aliments personnalisés. Un import n'écrase jamais silencieusement une fiche personnelle.

### food_nutrient
Une ligne par nutriment/aliment : food_item_id FK, nutrient_code (energy_kcal, protein_g, carbohydrate_g, fat_g, fiber_g), value_per_100 numeric(14,6), unit contrôlée. Clé primaire composée food_item_id + nutrient_code. Une valeur inconnue reste absente/null, jamais assimilée à zéro.

### food_portion
Champs : id, food_item_id FK, label (pièce, cuillère…), quantity_value, quantity_unit (g/ml), is_default. Équivalences explicites propres à chaque aliment. Pas de conversion générique g/ml; densité documentée nécessaire.

## 5. Journal alimentaire

### meal
Champs : id UUID PK, meal_type, consumed_at timestamptz, title nullable, notes nullable, status (draft/confirmed/deleted), totals_kcal, totals_protein_g, totals_carbohydrate_g, totals_fat_g, totals_fiber_g numeric(14,6), version bigint, created_at, updated_at, deleted_at nullable. Les totaux du repas sont recalculés depuis les lignes à chaque validation/modification. Les totaux journaliers et de période sont dérivés des repas confirmés. Les repas restent modifiables/supprimables à tout moment.

### meal_item
Champs : id UUID PK, meal_id FK, food_item_id nullable FK, recipe_id nullable FK, display_name_snapshot, quantity, unit, quantity_in_grams nullable, quantity_in_ml nullable, nutrient_snapshot JSONB versionné, line_totals, position, created_at, updated_at. Exactement une référence aliment ou recette. À la validation, copier nom, source, valeurs nutritionnelles, portion appliquée, quantité canonique et apports. Une modification explicite du repas reconstruit les instantanés avec les valeurs courantes du catalogue.

### meal_day_status
Une ligne par date locale : local_date PK, is_completed boolean, completed_at nullable, updated_at. Sans repas confirmé = sans données; avec repas sans marqueur explicite = partielle; complète uniquement après action de l'utilisateur.

## 6. Modèles et recettes

### meal_template / meal_template_item
Modèle enregistré volontairement et nommé par l'utilisateur, distinct des repas récents. Les 20 dernières consommations sont proposées en accès rapide; les anciennes sont recherchables. Réutiliser un repas ou modèle crée un brouillon indépendant, recalculé avec le catalogue courant.

### recipe / recipe_ingredient
Recette : id, name, description, instructions, servings, version, created_at, updated_at, is_active. Ingrédient : id, recipe_id, food_item_id, quantity, unit, position. À la consommation, composition et apports sont copiés dans l'instantané du repas; les changements ultérieurs de recette ne changent pas l'historique.

## 7. Mesures corporelles

### body_measurement
Champs : id, measurement_type (poids, tour de taille ou type extensible), value numeric(12,4), unit (kg/cm ou unité déclarée), measured_at timestamptz, notes nullable, created_at, updated_at, deleted_at nullable. Mesures modifiables/supprimables.

## 8. Photos et fichiers

### media_asset
Champs : id, meal_id nullable FK, ai_request_id nullable FK, storage_key opaque, mime_type, size_bytes, sha256, status, created_at, analyzed_at nullable, delete_after (30 jours après analyse), deleted_at nullable. Stockage privé. Supprimer une photo n'efface pas le repas. Export des fichiers en ZIP avec manifeste (ID logique, chemin, hash, type MIME et relation au repas/demande IA).

## 9. IA et conversations

### ai_request
Champs : id, task_type, status (queued_offline/pending/processing/completed/failed/cancelled), context_snapshot JSONB, input_media_id nullable FK, result_payload JSONB nullable, error_code nullable, created_at, last_attempt_at nullable, completed_at nullable, cancelled_at nullable. Une demande hors ligne reste localement dans « En attente » jusqu'à relance ou annulation, sans expiration automatique. Toute suggestion reste un brouillon jusqu'à validation.

### conversation / conversation_message
Conversation : id, title, created_at, expires_at (7 jours après création), deleted_at nullable. Message : id, conversation_id, role, content, context_refs JSONB, created_at. Suppression manuelle et expiration automatique à 7 jours. NutriPerso recharge le contexte utile à chaque échange.

## 10. Rappels et jeûne

### reminder / reminder_event
Rappel : id, label, schedule_rule JSONB contrôlé, enabled, timezone, created_at, updated_at. Événement : id, reminder_id, scheduled_at, presented_at nullable, delivery_state, created_at. Notifications locales PWA/navigateur en V1; livraison app fermée non garantie.

### fasting_protocol / fasting_history
Protocole : id, protocol_type, fasting_start_local_time, fasting_end_local_time, timezone, enabled, suspended_at nullable, created_at, updated_at. Historique : id, fasting_protocol_id, event_type, occurred_at, details JSONB. Un horaire quotidien fixe en V1.

## 11. Synchronisation et suppressions

### sync_operation
Champs : id UUID idempotency key, entity_type, entity_id, operation_type (create/update/delete), payload JSONB, client_created_at, server_confirmed_at nullable, status, attempt_count, last_error nullable. Le serveur attribue server_confirmed_at et une version monotone. La règle est « dernière modification confirmée = version conservée »; l'horloge cliente n'arbitre pas. Une suppression confirmée écrit un tombstone.

### record_tombstone
Champs : id, entity_type, entity_id, deleted_at_server, operation_id, retained_until. Empêche une ancienne copie locale ou restauration de faire réapparaître une entrée supprimée. Les suppressions complètes doivent être rejouées après restauration.

## 12. Sauvegardes et exports

### backup_run / backup_manifest_item
Métadonnées : id, début/fin, statut, destination (supabase/personal_server), période, taille, hash, version de format, vérification. Manifeste : type d'objet, clé logique, chemin d'archive, taille, SHA-256. Politique : quotidien, rétention 30 jours, deux destinations, chiffrement avant transfert, clé séparée, sauvegarde manuelle, alerte d'échec et test périodique de restauration. Rejouer les suppressions postérieures au point restauré.

### export_run
Trace facultative : format, date, statut, manifeste. Données structurées JSON/CSV; fichiers binaires ZIP avec manifeste. L'export utilisateur ne remplace pas une sauvegarde PostgreSQL restaurable.

## 13. Relations principales

- user_profile 1—N energy_goal.
- food_source 1—N food_item; food_item 1—N food_nutrient et food_portion.
- meal 1—N meal_item; chaque ligne référence un aliment ou une recette et conserve son instantané.
- meal_template 1—N meal_template_item; recipe 1—N recipe_ingredient.
- meal 1—N media_asset; ai_request 1—N media_asset selon besoin.
- conversation 1—N conversation_message.
- reminder 1—N reminder_event; fasting_protocol 1—N fasting_history.
- sync_operation produit éventuellement un record_tombstone.
- backup_run 1—N backup_manifest_item.

## 14. Index et contraintes

- Index meal(consumed_at DESC), meal(status, consumed_at DESC), meal_item(meal_id).
- Index food_item(normalized_name); unicité partielle (source_id, external_id) si external_id existe.
- Index body_measurement(measurement_type, measured_at DESC).
- Index ai_request(status, created_at), conversation(expires_at), reminder_event(scheduled_at).
- Index sync_operation(status, client_created_at), record_tombstone(entity_type, entity_id).
- Index energy_goal(effective_from, effective_to); absence de chevauchement des périodes.
- Politique explicite sur les clés étrangères; pas de cascade destructive sur les historiques/fichiers.
- Valeurs nutritionnelles en numeric, jamais float/real pour les calculs.

## 15. À préciser avant migrations SQL

Outil de migration et environnements; détails portions/densités et import USDA; formats/limites/compression photos; stockage des sauvegardes sur serveur personnel et gestion des clés; purge des tombstones; compatibilité Supabase/Hyperdrive et procédure de restauration.

Aucun SQL de production, aucune migration et aucune modification Supabase ne sont créés par ce document. Ils seront préparés après validation du modèle.
