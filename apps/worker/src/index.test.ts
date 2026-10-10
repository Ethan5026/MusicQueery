import { expect, test } from 'vitest'
import { corsHeaders } from './index'

const allowed = 'https://musicqueery.ethangruening.workers.dev,http://127.0.0.1:5173'

test('allows listed origins', () => {
  expect(corsHeaders('https://musicqueery.ethangruening.workers.dev', allowed)['Access-Control-Allow-Origin']).toBe(
    'https://musicqueery.ethangruening.workers.dev',
  )
  expect(corsHeaders('http://127.0.0.1:5173', allowed)['Access-Control-Allow-Origin']).toBeTruthy()
})

test('refuses unknown origins', () => {
  expect(corsHeaders('https://evil.example', allowed)).toEqual({})
  expect(corsHeaders('https://musicqueery.ethangruening.workers.dev.evil.example', allowed)).toEqual({})
  expect(corsHeaders(null, allowed)).toEqual({})
})
