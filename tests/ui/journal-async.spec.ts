import { expect, test, type Page } from '@playwright/test'

declare global {
  interface Window {
    journalGate?: { action: string; hit: boolean; release?: () => void }
  }
}
const today = () => new Date().toISOString().slice(0, 10)
const yesterday = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
const nav = (page: Page, mobile: boolean, name: string) => page.locator(mobile ? '.mobile-nav' : '.sidebar')
  .getByRole('button', { name: mobile && name === 'Vue d’ensemble' ? 'Accueil' : name, exact: false }).click()
async function cache(page: Page, date = today()) {
  return page.evaluate(date => {
    const key = Object.keys(localStorage).find(k => k.startsWith('nutrip-journal-v1:') && k.endsWith(':' + date))
    return key ? JSON.parse(localStorage.getItem(key)!) : null
  }, date)
}
async function gate(page: Page, action: string) {
  await page.evaluate(action => { window.journalGate = { action, hit: false } }, action)
}
async function waiting(page: Page) { await expect.poll(() => page.evaluate(() => window.journalGate?.hit)).toBe(true) }
async function release(page: Page) { await page.evaluate(() => window.journalGate!.release!()) }
async function offline(page: Page, value: boolean) {
  // Simulate the offline sync gate while keeping Vite assets available for reload.
  await page.evaluate(value => {
    sessionStorage.setItem('journal-test-offline', String(value))
    dispatchEvent(new Event(value ? 'offline' : 'online'))
  }, value)
}
async function addMeal(page: Page, label: string) {
  await page.getByRole('button', { name: '+ Ajouter un repas', exact: true }).click()
  await page.getByLabel('Nom facultatif', { exact: true }).last().fill(label)
  await page.getByRole('button', { name: 'Créer le repas', exact: true }).click()
}
async function attachPhoto(page: Page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20
    const context = canvas.getContext('2d')!; context.fillStyle = 'red'; context.fillRect(0, 0, 20, 20)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  await page.getByLabel('Choisir une photo dans la galerie ou les fichiers').setInputFiles({ name: 'async.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.getByRole('img', { name: 'Photo jointe localement au journal' })).toBeVisible()
}
async function clean(page: Page) { await expect.poll(async () => (await cache(page))?.dirty).toBe(false) }
async function correction(page: Page) {
  await page.getByRole('button', { name: 'Corriger', exact: true }).click()
  await page.getByLabel('Quantité consommée').fill('234')
  await page.getByLabel('Quantité consommée').blur()
  await clean(page)
}

const observations = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; observations.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) errors.push('Unexpected live API: ' + request.url()) })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => sessionStorage.getItem('journal-test-offline') !== 'true' })
  })
  // Instrument only the served test module. Persist the synthetic backend across
  // page reloads, then hold a successful response after its business operation.
  await page.route('**/src/dev-ui-fixtures.ts', async route => {
    const response = await route.fetch()
    const original = await response.text()
    const body = original.replace('export async function fixtureRequest(', 'async function originalFixtureRequest(')
    expect(body).not.toBe(original)
    await route.fulfill({ response, body: body + `
      const restored = JSON.parse(sessionStorage.getItem('journal-test-backend') || 'null');
      if (restored) {
        history.splice(0, history.length, ...restored.history);
        for (const [key, day] of restored.drafts) drafts.set(key, day);
      }
      export async function fixtureRequest(path, init = {}) {
        const result = await originalFixtureRequest(path, init);
        sessionStorage.setItem('journal-test-backend', JSON.stringify({ history, drafts: [...drafts] }));
        const gate = window.journalGate;
        if (gate && !gate.hit && path.endsWith('/' + gate.action)) {
          gate.hit = true;
          await new Promise(resolve => gate.release = resolve);
        }
        return result;
      }
    ` })
  })
  await page.goto('/')
  await expect(page.getByText(/MODE RECETTE UI/)).toBeVisible()
})
test.afterEach(async ({ page }) => { expect(observations.get(page)).toEqual([]) })

test('late confirmation keeps a new draft, originating date and offline reload; dashboard counts once', async ({ page, isMobile }) => {
  await nav(page, isMobile, 'Journal'); await correction(page)
  await gate(page, 'confirm')
  await page.getByRole('button', { name: 'Confirmer ce repas', exact: true }).click(); await waiting(page)
  await addMeal(page, 'B conservé')
  await offline(page, true)
  await page.getByLabel('Choisir la journée').fill(yesterday())
  await expect(page.locator('.journal-confirmed')).toHaveCount(1)
  await release(page)
  await expect.poll(async () => (await cache(page))?.pendingConfirm).toBe(null)
  expect((await cache(page)).dirty).toBe(true)
  expect((await cache(page)).day.meals.map((m: { label: string }) => m.label)).toEqual(['B conservé'])
  await expect(page.getByLabel('Choisir la journée')).toHaveValue(yesterday())
  await expect(page.locator('.journal-meal:not(.journal-confirmed)')).toHaveCount(0)
  await page.getByLabel('Choisir la journée').fill(today())
  await expect(page.locator('.journal-section-heading h2')).toHaveText('1 brouillon(s) · 1 confirmé(s)')
  await page.reload(); await nav(page, isMobile, 'Journal')
  await expect(page.locator('.journal-meal .meal-name input')).toHaveValue('B conservé')
  expect((await cache(page)).dirty).toBe(true)
  await offline(page, false); await clean(page)
  await nav(page, isMobile, 'Vue d’ensemble')
  await expect(page.locator('.card.nutrition .ring')).toContainText('395')
  await expect(page.locator('.card.nutrition p')).toContainText('1 repas confirmé')
})

test('late cancellation keeps another meal quantity, new draft and photo through reload without resurrecting totals', async ({ page, isMobile }) => {
  await nav(page, isMobile, 'Historique')
  await page.getByLabel('Rechercher un repas ou un aliment').fill('Repas synthétique 24')
  await page.locator('section.data-card').filter({ has: page.getByRole('heading', { name: 'Historique filtré', exact: true }) })
    .getByRole('button', { name: 'Réutiliser', exact: true }).click()
  await expect(page.getByLabel('Quantité consommée')).toHaveValue('123'); await clean(page)
  await gate(page, 'cancel')
  await page.locator('.journal-confirmed').getByRole('button', { name: 'Supprimer', exact: true }).click(); await waiting(page)
  await page.getByLabel('Quantité consommée').fill('250'); await page.getByLabel('Quantité consommée').blur()
  await addMeal(page, 'Après annulation'); await attachPhoto(page); await offline(page, true); await release(page)
  await expect.poll(async () => (await cache(page))?.pendingCancels.length).toBe(0)
  expect((await cache(page)).dirty).toBe(true)
  await expect(page.locator('.journal-section-heading h2')).toHaveText('2 brouillon(s) · 0 confirmé(s)')
  const photo = (await cache(page)).photoDataUrl
  await page.reload(); await nav(page, isMobile, 'Journal')
  await expect(page.getByLabel('Quantité consommée')).toHaveValue('250')
  await expect(page.locator('.journal-meal')).toHaveCount(2)
  expect((await cache(page)).photoDataUrl).toBe(photo)
  await offline(page, false); await clean(page)
  await nav(page, isMobile, 'Vue d’ensemble')
  await expect(page.locator('.card.nutrition p')).toContainText('2 brouillon(s)')
  await expect(page.locator('.card.nutrition .ring')).not.toContainText('209')
  await nav(page, isMobile, 'Journal')
  await page.getByRole('button', { name: 'Confirmer ce repas', exact: true }).filter({ visible: true }).first().click()
  await expect(page.locator('.journal-section-heading h2')).toHaveText('1 brouillon(s) · 1 confirmé(s)')
  await nav(page, isMobile, 'Vue d’ensemble')
  await expect(page.locator('.card.nutrition .ring')).toContainText('348')
  await expect(page.locator('.card.nutrition p')).toContainText('1 repas confirmé')
})

test('quantity and photo changed during confirmation remain a correction requiring explicit confirmation', async ({ page, isMobile }) => {
  await nav(page, isMobile, 'Journal'); await correction(page); await gate(page, 'confirm')
  await page.getByRole('button', { name: 'Confirmer ce repas', exact: true }).click(); await waiting(page)
  await page.getByLabel('Quantité consommée').fill('250'); await page.getByLabel('Quantité consommée').blur()
  await attachPhoto(page); await offline(page, true); await release(page)
  await expect.poll(async () => (await cache(page))?.pendingConfirm).toBe(null)
  expect((await cache(page)).dirty).toBe(true)
  const record = await cache(page)
  expect(record.day.meals[0].supersedesSnapshotId).toBe(record.snapshots.at(-1).snapshotId)
  await expect(page.getByLabel('Quantité consommée')).toHaveValue('250')
  await page.reload(); await nav(page, isMobile, 'Journal')
  await expect(page.getByLabel('Quantité consommée')).toHaveValue('250')
  expect((await cache(page)).photoDataUrl).toBe(record.photoDataUrl)
  await offline(page, false); await clean(page)
  await nav(page, isMobile, 'Vue d’ensemble')
  await expect(page.locator('.card.nutrition .ring')).toContainText('395')
  await nav(page, isMobile, 'Journal')
  await page.getByRole('button', { name: 'Confirmer ce repas', exact: true }).click()
  await expect(page.locator('.journal-section-heading h2')).toHaveText('0 brouillon(s) · 1 confirmé(s)')
  await nav(page, isMobile, 'Vue d’ensemble')
  await expect(page.locator('.card.nutrition .ring')).toContainText('417')
  await expect(page.locator('.card.nutrition p')).toContainText('1 repas confirmé')
})

test('draft PUT acknowledgment preserves a photo attached while saving', async ({ page, isMobile }) => {
  await nav(page, isMobile, 'Journal'); await gate(page, 'draft')
  await page.getByRole('button', { name: 'Corriger', exact: true }).click(); await waiting(page)
  await attachPhoto(page); const photo = (await cache(page)).photoDataUrl
  await release(page); await clean(page)
  expect((await cache(page)).photoDataUrl).toBe(photo)
  await expect(page.getByRole('img', { name: 'Photo jointe localement au journal' })).toBeVisible()
})

test('edits made during a slow confirmation retry automatically after its lock is released', async ({ page, isMobile }) => {
  await nav(page, isMobile, 'Journal'); await correction(page); await gate(page, 'confirm')
  await page.getByRole('button', { name: 'Confirmer ce repas', exact: true }).click(); await waiting(page)
  await addMeal(page, 'Synchronisation suivante')
  // Let the debounce fire while the old request still owns the lock.
  await page.waitForTimeout(850)
  expect((await cache(page)).dirty).toBe(true)
  await release(page)
  await expect.poll(async () => (await cache(page))?.pendingConfirm).toBe(null)
  await clean(page)
  await page.reload(); await nav(page, isMobile, 'Journal')
  await expect(page.locator('.journal-meal .meal-name input')).toHaveValue('Synchronisation suivante')
  await expect(page.locator('.journal-section-heading h2')).toHaveText('1 brouillon(s) · 1 confirmé(s)')
})
