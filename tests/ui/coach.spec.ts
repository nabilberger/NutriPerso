import { expect, test } from '@playwright/test'

test('Coach shows structured replies and can reopen and delete a local conversation', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Ouvrir Coach IA' }).click()
  await page.getByLabel('Compétence').selectOption('recipe')
  await page.getByLabel('Votre question').fill('Que préparer avec des pois chiches ?')
  await page.getByRole('button', { name: 'Envoyer au Coach' }).click()
  await expect(page.getByRole('heading', { name: 'Incertitudes' })).toBeVisible()
  await expect(page.getByText('Suggestion simulée')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Ouvrir Coach IA' }).click()
  await page.getByRole('button', { name: /Que préparer avec des pois chiches/ }).click()
  await expect(page.getByRole('heading', { name: 'Suggestions' })).toBeVisible()
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Suggestions' })).toHaveCount(0)
})
