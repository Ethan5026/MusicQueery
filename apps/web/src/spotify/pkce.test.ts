import { expect, test } from 'vitest'
import { codeChallenge, randomString } from './pkce'

test('S256 challenge matches RFC 7636 appendix B', async () => {
  expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  )
})

test('verifier uses only unreserved characters', () => {
  const v = randomString(64)
  expect(v).toHaveLength(64)
  expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/)
})
