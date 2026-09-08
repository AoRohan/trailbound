import { describe, expect, it } from 'vitest'
import {
  bestDayBefore,
  bestWindowSteps,
  bucketsToDayRecords,
  computeStreak,
  mergeDayRecords,
  sanitizeBuckets,
  splitAtHourBoundaries,
} from '../src/game/normalize'
import { TUNING } from '../src/game/content'
import type { DayRecord } from '../src/game/types'
import { at, bucket, hourBucket } from './helpers'

const NOW = at('2026-03-10', 23)

describe('sanitizeBuckets', () => {
  it('drops buckets already credited', () => {
    const after = at('2026-03-10', 12)
    const out = sanitizeBuckets([hourBucket('2026-03-10', 9, 500)], after, NOW)
    expect(out).toEqual([])
  })

  it('credits only the uncredited part of a straddling bucket', () => {
    // 10:00–11:00, 600 steps, already synced through 10:30 → half remains.
    const out = sanitizeBuckets(
      [hourBucket('2026-03-10', 10, 600)],
      at('2026-03-10', 10, 30),
      NOW,
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.steps).toBeCloseTo(300, 6)
  })

  it('clips buckets that run past now', () => {
    const now = at('2026-03-10', 10, 15)
    const out = sanitizeBuckets([hourBucket('2026-03-10', 10, 600)], at('2026-03-10', 0), now)
    expect(out[0]!.steps).toBeCloseTo(150, 6)
  })

  it('rejects future, negative, zero and non-finite data', () => {
    const out = sanitizeBuckets(
      [
        hourBucket('2026-03-20', 10, 5000), // future
        hourBucket('2026-03-10', 9, -100), // negative
        hourBucket('2026-03-10', 9, 0), // zero
        { start: NaN, end: 1, steps: 10 },
        { start: 1, end: NaN, steps: 10 },
        { start: at('2026-03-10', 9), end: at('2026-03-10', 10), steps: Infinity },
      ],
      at('2026-03-10', 0),
      NOW,
    )
    expect(out).toEqual([])
  })

  it('treats a zero-length bucket as an instant reading', () => {
    const t = at('2026-03-10', 9)
    const out = sanitizeBuckets([{ start: t, end: t, steps: 250 }], at('2026-03-10', 0), NOW)
    expect(out).toHaveLength(1)
    expect(out[0]!.steps).toBe(250)
  })

  it('returns buckets sorted by start', () => {
    const out = sanitizeBuckets(
      [hourBucket('2026-03-10', 14, 100), hourBucket('2026-03-10', 9, 100)],
      at('2026-03-10', 0),
      NOW,
    )
    expect(out.map((b) => b.start)).toEqual([at('2026-03-10', 9), at('2026-03-10', 14)])
  })
})

describe('splitAtHourBoundaries', () => {
  it('splits a multi-hour bucket proportionally', () => {
    // 09:30 → 11:30, 240 steps: 30min + 60min + 30min = 60 / 120 / 60.
    const start = at('2026-03-10', 9, 30)
    const out = splitAtHourBoundaries([{ start, end: start + 120 * 60_000, steps: 240 }])
    expect(out).toHaveLength(3)
    expect(out.map((b) => Math.round(b.steps))).toEqual([60, 120, 60])
  })

  it('conserves total steps', () => {
    const start = at('2026-03-10', 6, 17)
    const total = 1234
    const out = splitAtHourBoundaries([{ start, end: start + 400 * 60_000, steps: total }])
    const sum = out.reduce((acc, b) => acc + b.steps, 0)
    expect(sum).toBeCloseTo(total, 6)
  })

  it('leaves a bucket inside one hour alone', () => {
    const b = bucket('2026-03-10', 9, 20, 100)
    expect(splitAtHourBoundaries([b])).toEqual([b])
  })
})

describe('bestWindowSteps', () => {
  it('halves an even hour into its best 30 minutes', () => {
    expect(bestWindowSteps([hourBucket('2026-03-10', 9, 2400)])).toBeCloseTo(1200, 6)
  })

  it('finds a dense burst inside a quiet day', () => {
    const buckets = [
      hourBucket('2026-03-10', 8, 100),
      bucket('2026-03-10', 12, 30, 1800), // the burst
      hourBucket('2026-03-10', 15, 100),
    ]
    expect(bestWindowSteps(buckets)).toBeCloseTo(1800, 6)
  })

  it('adds up two adjacent halves of a window', () => {
    const start = at('2026-03-10', 12)
    const buckets = [
      { start, end: start + 15 * 60_000, steps: 500 },
      { start: start + 15 * 60_000, end: start + 30 * 60_000, steps: 500 },
    ]
    expect(bestWindowSteps(buckets)).toBeCloseTo(1000, 6)
  })

  it('is zero for no data', () => {
    expect(bestWindowSteps([])).toBe(0)
  })
})

describe('bucketsToDayRecords', () => {
  it('attributes dawn and dusk by local hour', () => {
    const buckets = splitAtHourBoundaries([
      hourBucket('2026-03-10', 7, 600), // dawn
      hourBucket('2026-03-10', 13, 900), // neither
      hourBucket('2026-03-10', 21, 400), // dusk
    ])
    const [day] = bucketsToDayRecords(buckets)
    expect(day!.steps).toBe(1900)
    expect(day!.dawnSteps).toBe(600)
    expect(day!.duskSteps).toBe(400)
  })

  it('separates days and returns them oldest first', () => {
    const days = bucketsToDayRecords([
      hourBucket('2026-03-11', 9, 100),
      hourBucket('2026-03-09', 9, 300),
      hourBucket('2026-03-10', 9, 200),
    ])
    expect(days.map((d) => d.date)).toEqual(['2026-03-09', '2026-03-10', '2026-03-11'])
  })
})

describe('mergeDayRecords', () => {
  const day = (date: string, steps: number): DayRecord => ({
    date,
    steps,
    bestBoutSteps: 0,
    dawnSteps: 0,
    duskSteps: 0,
    trained: false,
  })

  it('accumulates steps across syncs and reports what it credited', () => {
    const first = mergeDayRecords([], [day('2026-03-10', 1000)])
    expect(first.creditedByDay.get('2026-03-10')).toBe(1000)

    const second = mergeDayRecords(first.history, [day('2026-03-10', 500)])
    expect(second.history[0]!.steps).toBe(1500)
    expect(second.creditedByDay.get('2026-03-10')).toBe(500)
  })

  it('applies the daily cap to the merged total, not to each sync', () => {
    const cap = TUNING.maxCreditedStepsPerDay
    let result = mergeDayRecords([], [day('2026-03-10', cap - 100)])
    result = mergeDayRecords(result.history, [day('2026-03-10', 5000)])

    expect(result.history[0]!.steps).toBe(cap)
    // Only the 100 steps below the ceiling were creditable.
    expect(result.creditedByDay.get('2026-03-10')).toBe(100)
  })

  it('never un-sets a training check-in', () => {
    const trained: DayRecord = { ...day('2026-03-10', 100), trained: true }
    const result = mergeDayRecords([trained], [day('2026-03-10', 50)])
    expect(result.history[0]!.trained).toBe(true)
  })

  it('keeps the best bout rather than the latest', () => {
    const existing: DayRecord = { ...day('2026-03-10', 100), bestBoutSteps: 1500 }
    const result = mergeDayRecords([existing], [{ ...day('2026-03-10', 100), bestBoutSteps: 300 }])
    expect(result.history[0]!.bestBoutSteps).toBe(1500)
  })

  it('trims history to the retention window, keeping the newest', () => {
    const many: DayRecord[] = []
    for (let i = 0; i < TUNING.historyDays + 50; i++) {
      const d = new Date(2024, 0, 1 + i)
      many.push(day(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, 10))
    }
    const result = mergeDayRecords(many, [])
    expect(result.history).toHaveLength(TUNING.historyDays)
    expect(result.history[result.history.length - 1]!.date).toBe(many[many.length - 1]!.date)
  })
})

describe('computeStreak', () => {
  const day = (date: string, steps: number): DayRecord => ({
    date,
    steps,
    bestBoutSteps: 0,
    dawnSteps: 0,
    duskSteps: 0,
    trained: false,
  })

  it('counts back consecutive days that met the goal', () => {
    const history = [
      day('2026-03-08', 7000),
      day('2026-03-09', 8000),
      day('2026-03-10', 6500),
    ]
    expect(computeStreak(history, 6000, '2026-03-10')).toBe(3)
  })

  it('breaks on a missing day', () => {
    const history = [day('2026-03-08', 7000), day('2026-03-10', 7000)]
    expect(computeStreak(history, 6000, '2026-03-10')).toBe(1)
  })

  it('breaks on a day under the goal', () => {
    const history = [day('2026-03-09', 100), day('2026-03-10', 7000)]
    expect(computeStreak(history, 6000, '2026-03-10')).toBe(1)
  })

  it('is zero when today itself missed the goal', () => {
    const history = [day('2026-03-09', 9000), day('2026-03-10', 10)]
    expect(computeStreak(history, 6000, '2026-03-10')).toBe(0)
  })
})

describe('bestDayBefore', () => {
  const day = (date: string, steps: number): DayRecord => ({
    date,
    steps,
    bestBoutSteps: 0,
    dawnSteps: 0,
    duskSteps: 0,
    trained: false,
  })

  it('ignores the day itself', () => {
    const history = [day('2026-03-09', 9000), day('2026-03-10', 20000)]
    expect(bestDayBefore(history, '2026-03-10')).toBe(9000)
  })

  it('ignores later days, so a backfill cannot cancel an earlier record', () => {
    const history = [day('2026-03-08', 7000), day('2026-03-09', 30000)]
    expect(bestDayBefore(history, '2026-03-08')).toBe(0)
  })

  it('is zero with no earlier history', () => {
    expect(bestDayBefore([], '2026-03-10')).toBe(0)
  })
})
