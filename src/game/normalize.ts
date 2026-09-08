/**
 * Turning raw step buckets from a device into trustworthy daily records.
 *
 * This is the layer that assumes the data is hostile: clocks move backwards,
 * a reboot resets a counter, a health app backfills a week at once, a bucket
 * arrives timestamped next Tuesday. Everything downstream gets to assume clean
 * input because this file refuses to pass anything else along.
 */

import { TUNING } from './content'
import type { DayRecord, StepBucket } from './types'
import { dayKey, localHour, shiftDayKey, daysBetween } from './time'

const HOUR_MS = 3_600_000
const BOUT_WINDOW_MS = 30 * 60_000

/**
 * Drop and clip buckets down to the portion we are allowed to credit:
 * strictly after `after`, not in the future, positive, finite.
 *
 * A bucket straddling `after` or `now` is credited proportionally rather than
 * dropped whole — otherwise the hour you happen to sync in always vanishes.
 */
export function sanitizeBuckets(
  buckets: readonly StepBucket[],
  after: number,
  now: number,
): StepBucket[] {
  const out: StepBucket[] = []

  for (const b of buckets) {
    if (!Number.isFinite(b.start) || !Number.isFinite(b.end) || !Number.isFinite(b.steps)) continue
    if (b.steps <= 0) continue

    // Zero- or negative-length bucket: treat as an instant reading at `start`.
    if (b.end <= b.start) {
      if (b.start > after && b.start <= now) {
        out.push({ start: b.start, end: b.start + 1, steps: b.steps })
      }
      continue
    }

    const start = Math.max(b.start, after)
    const end = Math.min(b.end, now)
    if (end <= start) continue

    const fraction = (end - start) / (b.end - b.start)
    const steps = b.steps * fraction
    if (steps <= 0) continue

    out.push({ start, end, steps })
  }

  out.sort((a, b) => a.start - b.start)
  return out
}

/**
 * Split buckets so none crosses an hour boundary. Steps are apportioned by
 * duration, which assumes a constant pace inside a bucket — the only
 * assumption available, and harmless at hourly granularity or finer.
 */
export function splitAtHourBoundaries(buckets: readonly StepBucket[]): StepBucket[] {
  const out: StepBucket[] = []

  for (const b of buckets) {
    const total = b.end - b.start
    if (total <= 0) {
      out.push({ ...b })
      continue
    }

    let cursor = b.start
    // Walk hour edges in *local* time so DST shifts land where the user sees them.
    while (cursor < b.end) {
      const d = new Date(cursor)
      d.setMinutes(0, 0, 0)
      const nextEdge = d.getTime() + HOUR_MS
      const sliceEnd = Math.min(nextEdge, b.end)
      const steps = (b.steps * (sliceEnd - cursor)) / total
      if (steps > 0) out.push({ start: cursor, end: sliceEnd, steps })
      cursor = sliceEnd
    }
  }

  return out
}

/**
 * Largest number of steps falling inside any window of `windowMs`.
 *
 * The maximum always begins either at a bucket start or exactly `windowMs`
 * before a bucket end, so checking those candidates is exact — no sampling.
 */
export function bestWindowSteps(
  buckets: readonly StepBucket[],
  windowMs: number = BOUT_WINDOW_MS,
): number {
  if (buckets.length === 0) return 0

  const candidates = new Set<number>()
  for (const b of buckets) {
    candidates.add(b.start)
    candidates.add(b.end - windowMs)
  }

  let best = 0
  for (const start of candidates) {
    const end = start + windowMs
    let sum = 0
    for (const b of buckets) {
      const overlap = Math.min(b.end, end) - Math.max(b.start, start)
      if (overlap <= 0) continue
      const duration = b.end - b.start
      sum += duration > 0 ? (b.steps * overlap) / duration : b.steps
    }
    if (sum > best) best = sum
  }

  return best
}

/**
 * Aggregate sanitized, hour-split buckets into per-day records.
 * Returns days oldest-first.
 */
export function bucketsToDayRecords(buckets: readonly StepBucket[]): DayRecord[] {
  const byDay = new Map<string, StepBucket[]>()

  for (const b of buckets) {
    const key = dayKey(b.start)
    const list = byDay.get(key)
    if (list) list.push(b)
    else byDay.set(key, [b])
  }

  const records: DayRecord[] = []
  for (const [date, dayBuckets] of byDay) {
    let steps = 0
    let dawnSteps = 0
    let duskSteps = 0

    for (const b of dayBuckets) {
      steps += b.steps
      const hour = localHour(b.start)
      if (hour < TUNING.dawnBefore) dawnSteps += b.steps
      else if (hour >= TUNING.duskFrom) duskSteps += b.steps
    }

    records.push({
      date,
      steps: Math.round(steps),
      bestBoutSteps: Math.round(bestWindowSteps(dayBuckets)),
      dawnSteps: Math.round(dawnSteps),
      duskSteps: Math.round(duskSteps),
      trained: false,
    })
  }

  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return records
}

export interface MergeResult {
  history: DayRecord[]
  /** Steps actually credited per day after the daily cap — what earns paces. */
  creditedByDay: Map<string, number>
}

/**
 * Fold new day records into the stored history.
 *
 * The daily cap is applied to the *merged* total, not to each sync, so many
 * small syncs can never sneak past a ceiling one big sync would have hit.
 */
export function mergeDayRecords(
  history: readonly DayRecord[],
  incoming: readonly DayRecord[],
): MergeResult {
  const byDate = new Map<string, DayRecord>()
  for (const record of history) byDate.set(record.date, { ...record })

  const creditedByDay = new Map<string, number>()

  for (const record of incoming) {
    const existing = byDate.get(record.date)
    if (!existing) {
      const steps = Math.min(record.steps, TUNING.maxCreditedStepsPerDay)
      byDate.set(record.date, { ...record, steps })
      if (steps > 0) creditedByDay.set(record.date, steps)
      continue
    }

    const before = existing.steps
    const after = Math.min(before + record.steps, TUNING.maxCreditedStepsPerDay)
    const credited = after - before

    existing.steps = after
    existing.bestBoutSteps = Math.max(existing.bestBoutSteps, record.bestBoutSteps)
    existing.dawnSteps += record.dawnSteps
    existing.duskSteps += record.duskSteps
    existing.trained = existing.trained || record.trained

    if (credited > 0) creditedByDay.set(record.date, credited)
  }

  const merged = [...byDate.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  )

  // Trim to the retention window, keeping the newest days.
  const trimmed =
    merged.length > TUNING.historyDays ? merged.slice(merged.length - TUNING.historyDays) : merged

  return { history: trimmed, creditedByDay }
}

/**
 * Consecutive days up to and including `throughDate` that met `goal`.
 * A day missing from history counts as a zero-step day and breaks the streak.
 */
export function computeStreak(
  history: readonly DayRecord[],
  goal: number,
  throughDate: string,
): number {
  if (goal <= 0) return 0

  const byDate = new Map(history.map((r) => [r.date, r]))
  let streak = 0
  let cursor = throughDate

  // Bound the walk so a corrupt history can't loop forever.
  for (let i = 0; i < TUNING.historyDays; i++) {
    const record = byDate.get(cursor)
    if (!record || record.steps < goal) break
    streak++
    cursor = shiftDayKey(cursor, -1)
  }

  return streak
}

/**
 * Highest single-day step count strictly *before* `date`.
 *
 * Deliberately not "every day except this one": when a health app backfills
 * several days in one sync, the record each day set at the time it happened
 * must not be cancelled by a bigger day that came after it.
 * ISO date strings compare correctly as plain strings.
 */
export function bestDayBefore(history: readonly DayRecord[], date: string): number {
  let best = 0
  for (const record of history) {
    if (record.date >= date) continue
    if (record.steps > best) best = record.steps
  }
  return best
}

/** Days with no record at all between the first and last entry — for diagnostics. */
export function countGapDays(history: readonly DayRecord[]): number {
  if (history.length < 2) return 0
  const first = history[0]!.date
  const last = history[history.length - 1]!.date
  const span = daysBetween(first, last) + 1
  return Math.max(0, span - history.length)
}
