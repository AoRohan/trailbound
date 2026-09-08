import { describe, expect, it } from 'vitest'
import { ManualStepSource } from '../src/steps/ManualStepSource'
import { CompositeStepSource } from '../src/steps/CompositeStepSource'
import { resolve } from '../src/game/resolve'
import { newGame } from '../src/game/save'
import type { StepBucket } from '../src/game/types'
import type { StepSource, StepSourceStatus } from '../src/steps/StepSource'
import { at } from './helpers'

const NOW = at('2026-03-10', 14)

describe('ManualStepSource', () => {
  it('spreads an entry over the minutes it claims', async () => {
    const source = new ManualStepSource()
    source.add(600, 60, NOW)

    const [bucket] = await source.fetch(at('2026-03-10', 0), NOW)
    expect(bucket!.steps).toBe(600)
    expect(bucket!.end).toBe(NOW)
    expect(bucket!.start).toBe(NOW - 60 * 60_000)
  })

  it('clamps into the sync window but keeps every step', async () => {
    const source = new ManualStepSource()
    source.add(3000, 60, NOW)

    // Synced a minute ago: the window is tiny, but the player still declared
    // 3000 new steps and must be credited all of them.
    const since = NOW - 60_000
    const [bucket] = await source.fetch(since, NOW)

    expect(bucket!.steps).toBe(3000)
    expect(bucket!.start).toBeGreaterThanOrEqual(since)
    expect(bucket!.end).toBeLessThanOrEqual(NOW)
  })

  it('never emits an inverted or zero-length bucket', async () => {
    const source = new ManualStepSource()
    source.add(100, 60, NOW)

    const [bucket] = await source.fetch(NOW, NOW)
    expect(bucket!.end).toBeGreaterThan(bucket!.start)
  })

  it('hands each entry over exactly once', async () => {
    const source = new ManualStepSource()
    source.add(500, 60, NOW)

    expect(await source.fetch(0, NOW)).toHaveLength(1)
    expect(await source.fetch(0, NOW)).toHaveLength(0)
  })

  it('ignores nonsense entries', async () => {
    const source = new ManualStepSource()
    source.add(0, 60, NOW)
    source.add(-100, 60, NOW)
    source.add(Number.NaN, 60, NOW)
    source.add(Number.POSITIVE_INFINITY, 60, NOW)

    expect(await source.fetch(0, NOW)).toHaveLength(0)
  })

  it('reports itself as available and permitted', async () => {
    const status = await new ManualStepSource().status()
    expect(status.kind).toBe('manual')
    expect(status.available).toBe(true)
    expect(status.permissionGranted).toBe(true)
  })
})

describe('manual entry end to end', () => {
  it('credits the full amount even right after a sync', async () => {
    const source = new ManualStepSource()
    let state = newGame(at('2026-03-10', 0), 4242)
    state.dailyGoal = 1_000_000 // keep buffs out of the arithmetic

    // A first sync moves the sync point right up to now.
    state = resolve(state, await source.fetch(state.lastSyncAt, NOW), NOW).state
    expect(state.lastSyncAt).toBe(NOW)

    // Now type in a walk. The window is essentially empty, and the steps must
    // survive it anyway — this is the whole reason the manual source clamps the
    // window without scaling the count.
    const later = NOW + 5_000
    source.add(2000, 60, later)
    const result = resolve(state, await source.fetch(state.lastSyncAt, later), later)

    expect(result.report!.totalSteps).toBe(2000)
  })

  it('reads a squeezed manual entry as a burst, and that is on purpose', async () => {
    const source = new ManualStepSource()
    let state = newGame(at('2026-03-10', 0), 4242)
    state.dailyGoal = 1_000_000

    state = resolve(state, [], NOW).state

    // Because the entry gets compressed into the few seconds since the last
    // sync, bout detection sees a very dense burst and awards Forced March.
    // That is an artefact of the clamp rather than a real signal — but manual
    // entry is an honour system anyway (someone willing to fake a bout can
    // simply type a bigger number), and it only ever appears when no device
    // source is working. Documented here so it is a known trade, not a
    // surprise.
    const later = NOW + 5_000
    source.add(2000, 60, later)
    const result = resolve(state, await source.fetch(state.lastSyncAt, later), later)

    const day = result.report!.entries.find((e) => e.t === 'day')
    expect(day).toBeTruthy()
    if (day?.t === 'day') {
      expect(day.buffs.map((b) => b.id)).toContain('forcedMarch')
      expect(day.paces).toBe(Math.round(2000 * 1.15))
    }
  })
})

describe('CompositeStepSource', () => {
  const fakeDevice = (buckets: StepBucket[]): StepSource => ({
    kind: 'health-connect',
    async status(): Promise<StepSourceStatus> {
      return {
        kind: 'health-connect',
        available: true,
        permissionGranted: true,
        label: 'Health Connect',
        detail: 'fake',
        error: null,
      }
    },
    async requestPermission() {
      return true
    },
    async fetch() {
      return buckets
    },
  })

  it('takes its identity from the device source', () => {
    expect(new CompositeStepSource(fakeDevice([])).kind).toBe('health-connect')
    expect(new CompositeStepSource(null).kind).toBe('manual')
  })

  it('merges device data with what the player typed', async () => {
    const device = fakeDevice([{ start: NOW - 3_600_000, end: NOW, steps: 800 }])
    const composite = new CompositeStepSource(device)
    composite.add(200, 30)

    const buckets = await composite.fetch(at('2026-03-10', 0), NOW)
    const total = buckets.reduce((sum, b) => sum + b.steps, 0)
    expect(total).toBe(1000)
  })

  it('falls back to manual status when there is no device', async () => {
    const status = await new CompositeStepSource(null).status()
    expect(status.label).toBe('Manual entry')
  })

  it('reports the device status when there is one', async () => {
    const status = await new CompositeStepSource(fakeDevice([])).status()
    expect(status.label).toBe('Health Connect')
  })
})
