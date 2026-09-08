/**
 * Deterministic RNG.
 *
 * Deliberately *stateless from the save file's point of view*: we never
 * serialize a generator's internal state. Instead every random decision derives
 * its own stream from (masterSeed + a stable context string), e.g.
 * `rngFor(seed, 'node:combat:e17')`. Re-running a resolution over the same
 * inputs therefore produces byte-identical output, which is what makes the
 * offline-resolution log reproducible and the whole thing testable.
 */

/** FNV-1a, 32-bit. Stable across runs and platforms. */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [min, max], inclusive both ends. */
  int(min: number, max: number): number
  /** Uniform float in [min, max). */
  float(min: number, max: number): number
  /** True with probability `p`. */
  chance(p: number): boolean
  /** Uniform element. Throws on an empty array rather than returning undefined. */
  pick<T>(items: readonly T[]): T
  /** Weighted pick. Weights must be non-negative and not all zero. */
  weighted<T>(items: readonly { item: T; weight: number }[]): T
  /** In-place-free shuffle; returns a new array. */
  shuffle<T>(items: readonly T[]): T[]
}

/** mulberry32 — small, fast, good enough statistically for a game. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeRng(seed: number): Rng {
  const next = mulberry32(seed)
  const rng: Rng = {
    next,
    int(min, max) {
      if (max < min) [min, max] = [max, min]
      return min + Math.floor(next() * (max - min + 1))
    },
    float(min, max) {
      return min + next() * (max - min)
    },
    chance(p) {
      return next() < p
    },
    pick(items) {
      if (items.length === 0) throw new Error('rng.pick called with an empty array')
      return items[Math.floor(next() * items.length)]!
    },
    weighted(items) {
      if (items.length === 0) throw new Error('rng.weighted called with an empty array')
      let total = 0
      for (const entry of items) {
        if (entry.weight < 0) throw new Error('rng.weighted got a negative weight')
        total += entry.weight
      }
      if (total <= 0) throw new Error('rng.weighted needs at least one positive weight')
      let roll = next() * total
      for (const entry of items) {
        roll -= entry.weight
        if (roll < 0) return entry.item
      }
      return items[items.length - 1]!.item
    },
    shuffle(items) {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j]!, out[i]!]
      }
      return out
    },
  }
  return rng
}

/** Derive an independent, reproducible stream for a named context. */
export function rngFor(masterSeed: number, context: string): Rng {
  return makeRng((masterSeed ^ hashString(context)) >>> 0)
}

/** A fresh master seed for a brand-new save. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}
