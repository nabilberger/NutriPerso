export const coachSkills = {
  day: 'Bilan de la journée',
  meals: 'Idées de repas',
  recipe: 'Recette avec mes ingrédients',
  weight: 'Tendance du poids',
  history: 'Historique alimentaire',
  cooking: 'Préparation et substitutions',
} as const

export type CoachSkill = keyof typeof coachSkills
export type CoachAnswer = {
  recorded: string
  suggestions: string
  uncertainty: string
}
