import { expect, test } from 'vitest'
import { MODEL_VERSION } from './index'

test('package loads', () => {
  expect(MODEL_VERSION).toBe(0)
})
