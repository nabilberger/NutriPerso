import { expect, test, type Locator, type Page } from '@playwright/test'

const cameraName = 'Prendre une photo avec l’appareil photo'
const galleryName = 'Choisir une photo dans la galerie ou les fichiers'
const preview = (page: Page) => page.getByRole('img', { name: 'Photo jointe localement au journal', exact: true })
declare global {
  interface Window {
    photoDecodeCount: number
    releasePhotoDecode?: () => void
  }
}
const observed = new WeakMap<Page, { errors: string[]; requests: string[] }>()

async function imageFile(page: Page, name: string, color: string, width = 1800, height = 1200) {
  const data = await page.evaluate(({ color, width, height }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')!
    context.fillStyle = color; context.fillRect(0, 0, width, height)
    return canvas.toDataURL('image/png').split(',')[1]!
  }, { color, width, height })
  return { name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }
}
async function journalCache(page: Page, date?: string) {
  return page.evaluate(date => {
    const key = Object.keys(localStorage).find(key => key.startsWith('nutrip-journal-v1:') && (!date || key.endsWith(':' + date)))
    return key ? JSON.parse(localStorage.getItem(key)!) : null
  }, date)
}
async function decoded(page: Page) {
  return page.evaluate(() => window.photoDecodeCount)
}
async function holdNextDecode(page: Page) {
  await page.evaluate(() => {
    const original = window.createImageBitmap.bind(window)
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      await new Promise<void>(resolve => { window.releasePhotoDecode = resolve })
      window.createImageBitmap = original
      return Reflect.apply(original, window, args)
    }) as typeof createImageBitmap
  })
}
async function releaseDecode(page: Page) {
  await expect.poll(() => page.evaluate(() => typeof window.releasePhotoDecode)).toBe('function')
  await page.evaluate(() => window.releasePhotoDecode!())
}
async function inputCleared(input: Locator) {
  await expect(input).toHaveValue('')
  expect(await input.evaluate((element: HTMLInputElement) => element.files?.length)).toBe(0)
}

test.beforeEach(async ({ page, isMobile }) => {
  const result = { errors: [] as string[], requests: [] as string[] }
  observed.set(page, result)
  page.on('pageerror', error => result.errors.push(error.message))
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') || ['fetch', 'xhr'].includes(request.resourceType())) result.requests.push(request.url()) })
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window)
    ;window.photoDecodeCount = 0
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
      ;window.photoDecodeCount += 1
      return Reflect.apply(original, window, args)
    }) as typeof createImageBitmap
  })
  await page.goto('/')
  await expect(page.getByText(/MODE RECETTE UI/)).toBeVisible()
  await page.locator(isMobile ? '.mobile-nav' : '.sidebar').getByRole('button', { name: 'Journal', exact: false }).click()
  await expect(page.locator('.journal-section-heading h2')).toHaveText('0 brouillon(s) · 1 confirmé(s)')
})
test.afterEach(async ({ page }) => {
  expect(observed.get(page)?.errors).toEqual([])
  expect(observed.get(page)?.requests, 'no upload, API, fetch or XHR call is permitted in this fixture flow').toEqual([])
})

test('photo sources expose two accessible controls with distinct capture semantics and real chooser events', async ({ page, isMobile }) => {
  const camera = page.getByLabel(cameraName, { exact: true })
  const gallery = page.getByLabel(galleryName, { exact: true })
  await expect(page.locator('.journal-secondary-actions input[type=file]')).toHaveCount(2)
  await expect(camera).toHaveAttribute('type', 'file')
  await expect(camera).toHaveAttribute('accept', 'image/*')
  await expect(camera).toHaveAttribute('capture', 'environment')
  await expect(gallery).toHaveAttribute('type', 'file')
  await expect(gallery).toHaveAttribute('accept', 'image/*')
  expect(await gallery.getAttribute('capture')).toBeNull()
  await camera.focus()
  const [cameraChooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')])
  expect(await cameraChooser.element().getAttribute('capture')).toBe('environment')
  expect(cameraChooser.isMultiple()).toBe(false)
  await cameraChooser.setFiles([])
  const [galleryChooser] = await Promise.all([page.waitForEvent('filechooser'), gallery.click()])
  expect(await galleryChooser.element().getAttribute('capture')).toBeNull()
  await galleryChooser.setFiles([])
  await expect(preview(page)).toHaveCount(0)
  expect(await decoded(page)).toBe(0)
  if (isMobile) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('both photo inputs compress a synthetic file and process the same file again after resetting', async ({ page }, info) => {
  const photo = await imageFile(page, 'synthetic-red.png', '#d82020')
  const before = await journalCache(page)
  let count = 0
  for (const name of [cameraName, galleryName]) {
    const input = page.getByLabel(name, { exact: true })
    for (let selection = 0; selection < 2; selection++) {
      await input.setInputFiles(photo)
      count += 1
      await expect.poll(() => decoded(page)).toBe(count)
      await expect(preview(page)).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
      await inputCleared(input)
      await expect.poll(() => preview(page).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1280)
      expect(await preview(page).evaluate((image: HTMLImageElement) => image.naturalHeight)).toBe(853)
      const after = await journalCache(page)
      expect({ ...after, photoDataUrl: before.photoDataUrl }).toEqual(before)
    }
  }
  await expect(page.locator('.journal-confirmed')).toHaveCount(1)
  await page.screenshot({ path: info.outputPath('photo-preview.png'), fullPage: true })
})

test('changing or removing a photo works; an invalid image preserves the previous photo and recovery clears its error', async ({ page }) => {
  const camera = page.getByLabel(cameraName, { exact: true })
  const gallery = page.getByLabel(galleryName, { exact: true })
  await gallery.setInputFiles(await imageFile(page, 'synthetic-red.png', '#d82020'))
  await expect(preview(page)).toHaveAttribute('src', /^data:image\/jpeg/)
  const first = await preview(page).getAttribute('src')
  await camera.setInputFiles(await imageFile(page, 'synthetic-blue.png', '#2020d8', 120, 80))
  await expect.poll(() => preview(page).getAttribute('src')).not.toBe(first)
  const second = await preview(page).getAttribute('src')
  await gallery.setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') })
  await expect(page.getByRole('alert')).toHaveText('Cette photo n’a pas pu être préparée sur cet appareil.')
  await expect(preview(page)).toHaveAttribute('src', second!)
  await inputCleared(gallery)
  await gallery.setInputFiles(await imageFile(page, 'synthetic-green.png', '#20d820', 120, 80))
  await expect.poll(() => preview(page).getAttribute('src')).not.toBe(second)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.locator('.journal-photo').getByRole('button', { name: 'Retirer', exact: true }).click()
  await expect(preview(page)).toHaveCount(0)
})

test('cancel events and empty selections on both inputs preserve the photo, journal and status', async ({ page }) => {
  await page.getByLabel(galleryName, { exact: true }).setInputFiles(await imageFile(page, 'synthetic-red.png', '#d82020'))
  await expect(preview(page)).toHaveAttribute('src', /^data:image\/jpeg/)
  const before = await journalCache(page)
  const status = await page.locator('.journal-sync').innerText()
  for (const name of [cameraName, galleryName]) {
    const input = page.getByLabel(name, { exact: true })
    await input.dispatchEvent('cancel')
    await input.setInputFiles([])
    await inputCleared(input)
    expect(await journalCache(page)).toEqual(before)
    expect(await page.locator('.journal-sync').innerText()).toBe(status)
    await expect(page.getByRole('alert')).toHaveCount(0)
  }
  expect(await decoded(page)).toBe(1)
})

test('photo completion preserves a meal corrected and confirmed while compression is pending', async ({ page }) => {
  const photo = await imageFile(page, 'slow-photo.png', '#d82020')
  await page.getByRole('button', { name: 'Corriger', exact: true }).click()
  await holdNextDecode(page)
  await page.getByLabel(cameraName, { exact: true }).setInputFiles(photo)
  await page.getByLabel('Quantité consommée').fill('234')
  await page.getByLabel('Quantité consommée').blur()
  await page.getByRole('button', { name: 'Confirmer ce repas', exact: true }).click()
  await expect(page.locator('.journal-section-heading h2')).toHaveText('0 brouillon(s) · 1 confirmé(s)')
  const beforeCompletion = await journalCache(page)
  await releaseDecode(page)
  await expect(preview(page)).toHaveAttribute('src', /^data:image\/jpeg/)
  await expect(page.locator('.journal-section-heading h2')).toHaveText('0 brouillon(s) · 1 confirmé(s)')
  await expect(page.locator('.journal-total strong')).toHaveText(['395 kcal', '25.3 g', '22.7 g', '7.4 g', '21.6 g'])
  const after = await journalCache(page)
  expect({ ...after, photoDataUrl: beforeCompletion.photoDataUrl }).toEqual(beforeCompletion)
})

test('a photo finishing after a date change stays with its originating day', async ({ page }) => {
  const date = await page.getByLabel('Choisir la journée').inputValue()
  const photo = await imageFile(page, 'slow-photo.png', '#d82020')
  await holdNextDecode(page)
  await page.getByLabel(cameraName, { exact: true }).setInputFiles(photo)
  await page.getByLabel('Choisir la journée').fill('2000-01-01')
  await expect(page.locator('.journal-section-heading h2')).toHaveText('0 brouillon(s) · 0 confirmé(s)')
  const otherDay = await journalCache(page, '2000-01-01')
  const otherStatus = await page.locator('.journal-sync').innerText()
  await releaseDecode(page)
  await expect.poll(() => journalCache(page, date).then(cache => cache.photoDataUrl)).toMatch(/^data:image\/jpeg/)
  await expect(preview(page)).toHaveCount(0)
  expect(await journalCache(page, '2000-01-01')).toEqual(otherDay)
  expect(await page.locator('.journal-sync').innerText()).toBe(otherStatus)
  await page.getByLabel('Choisir la journée').fill(date)
  await expect(preview(page)).toHaveAttribute('src', /^data:image\/jpeg/)
  await expect(page.locator('.journal-section-heading h2')).toHaveText('0 brouillon(s) · 1 confirmé(s)')
})
