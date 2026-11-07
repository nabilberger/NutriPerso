# Mission 023 — Coach IA

## Étude des compétences

| Projet et licence | Approche retenue | Limite pour NutriPerso |
| --- | --- | --- |
| [Cooklang Skills](https://github.com/cooklang/cooklang-skills), MIT | Séparer recette, adaptation, préparation et planification en tâches ciblées. | Les workflows de lecture de fichiers Cooklang et le serveur Cook MCP doublonneraient le journal et le catalogue. |
| [Nutritional Specialist](https://github.com/ailabs-393/ai-labs-claude-skills/tree/main/dist/skills/nutritional-specialist), dépôt MIT | Appliquer systématiquement les préférences et restrictions disponibles. | Le gestionnaire de préférences Python et sa persistance locale créeraient un second profil. |
| [Mealie](https://github.com/mealie-recipes/mealie), AGPL-3.0 | Distinguer les recettes, leur planification et les instructions de préparation. | Application autonome avec API et interface propres. Aucune dépendance ni réutilisation de code. |

Les six compétences sont écrites pour NutriPerso. Aucun script tiers, serveur MCP ou format de recette supplémentaire n’est installé.

## Parcours et données

Le client choisit une compétence et envoie une question bornée avec au plus deux échanges précédents. La route privée valide le jeton Supabase avant la lecture. L’identifiant effectif vient de cette validation. Le Worker relit le contexte utile à chaque échange et n’expose aucune fonction d’écriture au modèle.

- Bilan quotidien et idées de repas utilisent les instantanés confirmés et le moteur déterministe. Les brouillons sont exclus. Le profil, le poids cible et les préférences alimentent les idées lorsque pertinents.
- Historique et tendance du poids utilisent au maximum 14 repas confirmés ou 20 mesures datées. Les notes des mesures ne sont pas transmises.
- Recettes et substitutions reçoivent les préférences structurées et les ingrédients indiqués par l’utilisateur.
- Avatar, identifiants, adresse électronique et notes libres du profil sont exclus. L’activité déclarée et les objectifs énergétiques datés ne sont pas disponibles dans le profil actuel.

Le [prompt v1](../worker/src/coach-prompt.ts) combine une base commune, une langue et une consigne par compétence. Gemini renvoie trois champs textuels validés puis affichés séparément. Le prototype demande au modèle de ne pas inventer de chiffres. Il ne vérifie pas factuellement chaque phrase produite.

## Budget, conservation et activation

La route est inactive tant que `COACH_ENABLED` ne vaut pas `1`. L’adaptateur utilise le modèle et le secret existants, un seul appel par soumission, une réponse structurée bornée et aucune relance automatique. La réservation atomique existante fait respecter le plafond applicatif global de 50 DH par mois et 20 tentatives par jour, avec au plus 0,10 DH réservés par tentative. Le compteur est commun aux deux parcours. Une erreur après réservation consomme encore la réserve. Le plafond comptable ne garantit pas le montant facturé par Google. Avant activation, vérifier le coût réel sur le modèle retenu avec un contexte synthétique représentatif, taxes et conversion comprises. [Tarifs officiels](https://ai.google.dev/gemini-api/docs/pricing).

Le prototype conserve au plus 20 conversations dans le navigateur, par compte, pendant sept jours à compter de leur création. La suppression manuelle est immédiate. Le nettoyage automatique s’effectue lorsque l’interface est ouverte ou rouverte. Une fermeture prolongée reporte l’effacement local. Il manque la persistance interappareils et une purge indépendante du navigateur pour respecter le §3.8. Ces éléments nécessitent un stockage serveur isolé par compte et une politique de rétention validée.

Avant activation, valider le traitement des données de profil et de suivi par le projet Gemini, le partage du quota quotidien avec les photos, la conservation serveur et le coût effectif. Préparer ensuite le stockage et sa purge, vérifier les tests isolés, appliquer uniquement la migration validée, puis publier Worker et Pages après autorisation distincte.
