import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('journal exposes distinct camera and gallery file inputs', async () => {
  const journal = await readFile(new URL('../../src/Journal.tsx', import.meta.url), 'utf8')
  const camera = journal.match(/<label className="journal-photo-button">Prendre une photo<input([^>]*)\/>/)
  const gallery = journal.match(/<label className="journal-photo-button">Choisir dans la galerie \/ fichiers<input([^>]*)\/>/)

  assert.ok(camera, 'camera action should have its own input')
  assert.ok(gallery, 'gallery action should have its own input')
  assert.match(camera[1]!, /type="file"/)
  assert.match(camera[1]!, /accept="image\/\*"/)
  assert.match(camera[1]!, /capture="environment"/)
  assert.match(gallery[1]!, /type="file"/)
  assert.match(gallery[1]!, /accept="image\/\*"/)
  assert.doesNotMatch(gallery[1]!, /capture=/)
  assert.match(camera[1]!, /attachPhoto\(event\.currentTarget\.files\?\.\[0\], event\.currentTarget\)/)
  assert.match(gallery[1]!, /attachPhoto\(event\.currentTarget\.files\?\.\[0\], event\.currentTarget\)/)
})

test('photo cancellation preserves the current attachment and permits same-file reselection', async () => {
  const journal = await readFile(new URL('../../src/Journal.tsx', import.meta.url), 'utf8')
  assert.match(journal, /if \(input\) input\.value = ''/)
  assert.match(journal, /if \(!file\) return \/\/ User cancelled/)
})
