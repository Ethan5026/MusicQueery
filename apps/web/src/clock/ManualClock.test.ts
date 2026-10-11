import { expect, test } from 'vitest'
import type { JumpEvent } from './types'
import { ManualClock } from './ManualClock'

function setup() {
  let t = 1000
  const c = new ManualClock(() => t)
  const jumps: JumpEvent[] = []
  c.onJump((e) => jumps.push(e))
  return { c, jumps, advance: (ms: number) => (t += ms) }
}

test('runs only while playing', () => {
  const { c, jumps, advance } = setup()
  c.load('x', 10_000, 2000)
  advance(500)
  expect(c.positionMs()).toBe(2000)
  c.play()
  advance(1500)
  expect(c.positionMs()).toBe(3500)
  c.pause()
  advance(1000)
  expect(c.positionMs()).toBe(3500)
  expect(jumps.map((j) => j.kind)).toEqual(['track', 'play', 'pause'])
})

test('seek clamps to the track and keeps playing', () => {
  const { c, advance } = setup()
  c.load('x', 10_000)
  c.play()
  c.seek(-50)
  expect(c.positionMs()).toBe(0)
  c.seek(9000)
  advance(400)
  expect(c.positionMs()).toBe(9400)
  expect(c.playing).toBe(true)
})

test('stops at the end; play again starts over', () => {
  const { c, advance } = setup()
  c.load('x', 1000)
  c.play()
  advance(1500)
  expect(c.positionMs()).toBe(1000)
  expect(c.checkEnd()).toBe(true)
  expect(c.playing).toBe(false)
  c.play()
  advance(100)
  expect(c.positionMs()).toBe(100)
})

test('does nothing without a track', () => {
  const { c } = setup()
  c.play()
  expect(c.playing).toBe(false)
})
