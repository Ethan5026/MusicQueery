// Per-output-device offset (ms), keyed by Spotify device id. Negative = audio lags the report.

const KEY = 'mq.offsets'

function all(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

export function offsetFor(deviceId: string | null): number {
  return deviceId ? (all()[deviceId] ?? 0) : 0
}

export function setOffset(deviceId: string, ms: number): void {
  localStorage.setItem(KEY, JSON.stringify({ ...all(), [deviceId]: Math.round(ms) }))
}
