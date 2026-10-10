import { expect, test } from 'vitest'
import { corsHeaders } from './index'

const allowed = 'https://musicqueery.pages.dev,http://127.0.0.1:5173'

test('allows listed and preview origins', () => {
  expect(corsHeaders('https://musicqueery.pages.dev', allowed)['Access-Control-Allow-Origin']).toBe(
    'https://musicqueery.pages.dev',
  )
  expect(corsHeaders('https://abc123.musicqueery.pages.dev', allowed)['Access-Control-Allow-Origin']).toBeTruthy()
})

test('refuses unknown origins', () => {
  expect(corsHeaders('https://evil.example', allowed)).toEqual({})
  expect(corsHeaders('https://x.musicqueery.pages.dev.evil.example', allowed)).toEqual({})
  expect(corsHeaders(null, allowed)).toEqual({})
})
