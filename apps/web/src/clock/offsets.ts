import type { BiasStore } from './SpotifyClock'

// Per-output-device offset (ms), keyed by Spotify device id, set by tap-along calibration.
// Negative = audio lags the report. Read every frame, so kept in memory and written through to localStorage.

const KEY = 'mq.offsets'
const NAMES_KEY = 'mq.deviceNames'

function read(key: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage blocked: keep the value in memory only
  }
}

let offsets: Record<string, number> | null = null
const all = (): Record<string, number> => (offsets ??= read(KEY))

export function offsetFor(deviceId: string | null): number {
  return deviceId ? (all()[deviceId] ?? 0) : 0
}

export function setOffset(deviceId: string, ms: number, name?: string | null): void {
  offsets = { ...all(), [deviceId]: Math.round(ms) }
  write(KEY, offsets)
  if (name) write(NAMES_KEY, { ...(read(NAMES_KEY) as unknown as Record<string, string>), [deviceId]: name })
}

export function clearOffset(deviceId: string): void {
  offsets = { ...all() }
  delete offsets[deviceId]
  write(KEY, offsets)
}

/** Calibrated devices with their names (when known), for Settings. */
export function listOffsets(): Array<{ id: string; name: string | null; ms: number }> {
  const names = read(NAMES_KEY) as unknown as Record<string, string>
  return Object.entries(all()).map(([id, ms]) => ({ id, name: names[id] ?? null, ms }))
}

// Learned per-device start bias (see SpotifyClock), kept across restarts.
const BIAS_KEY = 'mq.startBias'

let bias: Record<string, number> | null = null
const biases = (): Record<string, number> => (bias ??= read(BIAS_KEY))

export const startBiasStore: BiasStore = {
  get: (deviceId) => (deviceId ? (biases()[deviceId] ?? 0) : 0),
  set: (deviceId, ms) => {
    bias = { ...biases(), [deviceId]: Math.round(ms) }
    write(BIAS_KEY, bias)
  },
}
