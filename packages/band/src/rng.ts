// A small seeded generator, so each bar's choices depend only on (seed, bar): the same bar sounds the same after
// a seek, and tests are deterministic.

export type Rng = () => number

export function rng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const barRng = (seed: number, bar: number, salt: number): Rng => rng(seed * 7919 + bar * 104729 + salt * 15485863)

export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!

/** Weighted pick: `xs` as [item, weight] pairs. */
export function weighted<T>(r: Rng, xs: ReadonlyArray<readonly [T, number]>): T {
  const total = xs.reduce((s, x) => s + x[1], 0)
  let v = r() * total
  for (const [x, w] of xs) {
    v -= w
    if (v <= 0) return x
  }
  return xs[xs.length - 1]![0]
}
