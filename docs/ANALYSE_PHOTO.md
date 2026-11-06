# Mission 014 — analyse photographique

Base : `dc2f236caa40d75cb25237fb4c409e27784d8c37`. Ticket #6 ; coach #11 exclu.

## Parcours

Caméra arrière/galerie existantes → compression JPEG canvas (EXIF non recopiés, 1280px, qualité 0,78, maximum 1 Mo ; entrée 20 Mo) → clic explicite → Worker Auth → réservation atomique du coût → photo privée → Gemini → proposition versionnée et validée → corrections → sélection de chaque fiche réelle USDA/personnelle et de sa quantité → nouveau brouillon → confirmation explicite habituelle.

Aucun chiffre Gemini n'entre dans le calcul. Les propositions ne sont pas des fiches nutritionnelles. Quantité inconnue = null ; la sélection de fiche demande une quantité réelle à vérifier. Les instantanés historiques et le moteur restent inchangés. Erreurs et indisponibilités laissent la saisie manuelle opérationnelle.

## Configuration préparée, non déployée

- Secret Worker `GEMINI_API_KEY`, jamais frontend/Git/log/URL.
- Variable Worker `GEMINI_MODEL` : modèle Gemini Flash choisi et validé lors de la mise en service ; pas de nom de modèle figé.
- Variable `AI_REQUEST_MAX_DH` : borne supérieure **validée** en DH par requête (0 < valeur ≤ 5). À calculer selon modèle/tarifs, tokens image/entrée, plafond sortie 3000 et éventuels tokens de raisonnement. Laisser absent tant que non vérifié : refus fermé.
- Binding R2 privé `MEAL_PHOTOS`, bucket préparé `nutriperso-meal-photos` : pas de domaine public ni r2.dev. Ne pas créer/publier sans revue. Le frontend n'a ni clé R2 ni URL publique. Objets `user Auth/UUID.jpg` ; routes list/delete limitées à l'utilisateur validé.
- Migration `20261106223233_photo_analysis_budget.sql` préparée seulement : table RLS sans droit client et RPC invoker service-role exclusivement. Pas de db push exécuté.
- Cron Worker préparé à `15 * * * *` : purge des objets expirés par métadonnée ; rétention 30 jours à partir de la tentative d'analyse. Suppression manuelle immédiate via Worker, indépendante des repas. La purge physique a une granularité horaire (jusqu'à une heure de retard si ordonnanceur actif). Le listing masque les objets expirés. Une panne cron nécessite supervision/rattrapage.
- Copies locales : expiration au prochain chargement du journal ; demande hors ligne en attente conservée jusqu'à relance/annulation, aucune relance automatique. localStorage reste limité : l'échec est signalé. Retirer localement une photo ne supprime pas la copie distante : action explicite « Supprimer la photo distante » ou liste « Photos privées ».

## Budget et erreurs

50 DH/mois UTC **global** pour l'application personnelle, 20 tentatives/jour ; verrou transactionnel PostgreSQL avant toute transmission fournisseur, anti-rejeu UUID. Chaque tentative réserve sa borne maximale, même en cas d'erreur/timeout ; aucun remboursement automatique sur résultat incertain. Les tokens réels et le modèle sont conservés sans contenu ni photo ; compteur expose tentatives et DH réservés. Il s'agit d'une enveloppe conservatrice, pas d'une facture convertie fictivement. Coûts R2/Cloudflare et autres fonctionnalités doivent être déduits du budget global avant activation payante ; configurer une borne et une enveloppe adaptées après revue des prix. Aucun appel réel ni mesure tarifaire de Gemini effectué dans les tests.

Une tentative échouée exige une nouvelle relance explicite et un nouvel UUID ; pas de retry automatique payant. Le suivi incomplet reste réservé en cas de perte de réponse. L'adaptateur `PhotoAI` est remplaçable ; sorties tronquées, refus, unités/quantités invalides sont rejetés intégralement. Les photos sont données non fiables, et le prompt demande d'ignorer les instructions visibles. L'IA n'a aucune route d'écriture journal.

## Vérification

```
npm test
npx tsc --noEmit
npm run test:types:ui
npm run build
npm run test:integration:db
npm run test:integration:migrations
npm run test:ui:fixtures
```

Les tests fournisseur injectent fetch/PhotoAI ; les parcours UI utilisent des photos canvas synthétiques et une réponse déclarée fictive, sans réseau externe. PostgreSQL valide permissions, anti-rejeu et plafond mensuel. La chaîne SQL contient maintenant neuf migrations.

Limites : aucune qualité de reconnaissance Gemini mesurée, aucune API Gemini réelle, aucun stockage R2 raccordé ni cron distant testé. Pixel 7 émulé ne valide ni ouverture physique caméra, ni permissions Android, ni qualité photo réelle. Recette raccordée, conditions de rétention fournisseur et coût modèle restent obligatoires avant mise en service. La rétention chez Gemini est distincte du stockage NutriPerso.

Sources consultées : https://ai.google.dev/gemini-api/docs/structured-output ; https://supabase.com/changelog.md ; https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/ .
