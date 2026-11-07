# Mission 026 — Profil et suivi

## Parcours livré

- Proposition facultative de configuration en trois étapes, accessible ensuite depuis Mon profil. L’assistant utilise le formulaire existant et ses validations. Le retour d’étape conserve les champs en mémoire. Le passage ou la fin est mémorisé par compte et navigateur. La formulation facultative applique la demande de la Mission 026 pour ce parcours. Le formulaire initial obligatoire et les cibles énergétiques datées du §3.10 restent à traiter.
- Tour de taille daté en centimètres, précision au dixième, plage de 30 à 300 cm, ajout, suppression, courbe et historique séparés. Le poids et les données de journal n’ont aucun changement de schéma. La nouvelle table est accessible uniquement au Worker, avec RLS, et les requêtes sont filtrées par l’identité Supabase vérifiée. Une installation sans la migration garde le suivi du poids accessible.
- Le jeûne reste dans les paramètres du profil, avec un indicateur sur l’accueil et des choix de rappels propres à l’appareil. Chaque rappel nécessite un geste de consentement et la permission du navigateur. Les événements utilisent l’heure du fuseau configuré, notamment pour une fenêtre qui traverse minuit. Un rappel déjà présenté pour un événement et une date est dédupliqué sur cet appareil. L’animation de succès est courte et respecte la réduction des mouvements.

## Limites et décisions restantes

L’assistant ne reprend pas son étape après un rechargement, ne synchronise pas son état entre appareils et n’inclut pas de saisie de mesure initiale. Les mesures se saisissent dans Suivi. Les plages d’objectif de maintien, l’historique des sessions de jeûne, la suspension à durée déterminée et la progression d’objectif restent à traiter dans le backlog #25.

Les notifications locales nécessitent une PWA active, un service worker et une permission accordée. Elles ne sont pas garanties lorsque la page est suspendue ou fermée. Le choix d’un service Push et de sa clé, le traitement des abonnements et la recette sur un appareil Android physique restent ouverts. La synchronisation périodique du navigateur ne garantit pas une heure de déclenchement. [Notifications et opérations en arrière-plan](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation).

## Mise en service à faire approuver

Valider d’abord le parcours facultatif et les rappels au premier plan. Vérifier la sauvegarde et le registre Supabase, puis contrôler que le dry-run propose uniquement la nouvelle migration de tour de taille. Après autorisation séparée, appliquer la migration additive, vérifier les ACL, publier le Worker compatible avec l’ancien frontend, puis publier Pages. Aucune application distante, modification de secret ou publication n’est autorisée par cette PR.
