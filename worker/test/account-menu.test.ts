import assert from 'node:assert/strict'
import test from 'node:test'
import { nextAccountMenuIndex } from '../../src/account-menu-navigation.ts'

test('account menu arrow keys wrap and choose a sensible initial target', () => {
  assert.equal(nextAccountMenuIndex('ArrowDown', -1, 2), 0)
  assert.equal(nextAccountMenuIndex('ArrowUp', -1, 2), 1)
  assert.equal(nextAccountMenuIndex('ArrowDown', 1, 2), 0)
  assert.equal(nextAccountMenuIndex('ArrowUp', 0, 2), 1)
})

test('account menu Home and End keys focus the first and last actions', () => {
  assert.equal(nextAccountMenuIndex('Home', 1, 2), 0)
  assert.equal(nextAccountMenuIndex('End', 0, 2), 1)
  assert.equal(nextAccountMenuIndex('Tab', 0, 2), null)
  assert.equal(nextAccountMenuIndex('ArrowDown', -1, 0), null)
})
