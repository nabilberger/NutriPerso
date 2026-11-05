import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('camera and gallery controls request distinct browser sources', async () => {
  const journal = await readFile(new URL('../../src/Journal.tsx', import.meta.url), 'utf8')
  const camera = journal.match(/<label className="journal-photo-button">Prendre une photo<input([^>]*)\/>/)
  const gallery = journal.match(/<label className="journal-photo-button">Choisir dans la galerie \/ fichiers<input([^>]*)\/>/)

  assert.ok(camera)
  assert.ok(gallery)
  assert.match(camera[1]!, /type="file"/)
  assert.match(camera[1]!, /accept="image\/\*"/)
  assert.match(camera[1]!, /capture="environment"/)
  assert.match(gallery[1]!, /type="file"/)
  assert.match(gallery[1]!, /accept="image\/\*"/)
  assert.doesNotMatch(gallery[1]!, /capture=/)
})

test('cancelled selection keeps existing photo and input reset allows selecting same file again', async () => {
  const journal = await readFile(new URL('../../src/Journal.tsx', import.meta.url), 'utf8')
  assert.match(journal, /input\.value = ''/)
  assert.match(journal, /if \(!file\) return/)
})
