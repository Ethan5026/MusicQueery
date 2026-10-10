import { expect, test } from 'vitest'
import { THEORY_VERSION } from './index'

test('package loads', () => {
  expect(THEORY_VERSION).toBe(0)
})
