import type { StepBucket } from '../src/game/types'

/** Local-time timestamp for a `YYYY-MM-DD` date at a given hour/minute. */
export function at(date: string, hour = 0, minute = 0): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, hour, minute, 0, 0).getTime()
}

/** A bucket spanning `minutes` from the given local time. */
export function bucket(
  date: string,
  hour: number,
  minutes: number,
  steps: number,
): StepBucket {
  const start = at(date, hour)
  return { start, end: start + minutes * 60_000, steps }
}

/** One whole hour of steps. */
export function hourBucket(date: string, hour: number, steps: number): StepBucket {
  return bucket(date, hour, 60, steps)
}

/**
 * A day of steps spread thinly across the middle of the day: eight hourly
 * buckets from 10:00, chosen so the data triggers no dawn, dusk or bout buff.
 * Tests that want a buff should ask for it explicitly.
 */
export function dayOfSteps(date: string, steps: number): StepBucket[] {
  const hours = [10, 11, 12, 13, 14, 15, 16, 17]
  const per = steps / hours.length
  return hours.map((h) => hourBucket(date, h, per))
}
