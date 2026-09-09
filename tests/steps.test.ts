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

    const { incremental } = await source.fetch(at('2026-03-10', 0), NOW)
    const [bucket] = incremental
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
    const [bucket] = (await source.fetch(since, NOW)).incremental

    expect(bucket!.steps).toBe(3000)
    expect(bucket!.start).toBeGreaterThanOrEqual(since)
    expect(bucket!.end).toBeLessThanOrEqual(NOW)
  })

  it('never emits an inverted or zero-length bucket', async () => {
    const source = new ManualStepSource()
    source.add(100, 60, NOW)

    const [bucket] = (await source.fetch(NOW, NOW)).incremental
    expect(bucket!.end).toBeGreaterThan(bucket!.start)
  })

  it('hands each entry over exactly once', async () => {
    const source = new ManualStepSource()
    source.add(500, 60, NOW)

    expect((await source.fetch(0, NOW)).incremental).toHaveLength(1)
    expect((await source.fetch(0, NOW)).incremental).toHaveLength(0)
  })

  it('ignores nonsense entries', async () => {
    const source = new ManualStepSource()
    source.add(0, 60, NOW)
    source.add(-100, 60, NOW)
    source.add(Number.NaN, 60, NOW)
    source.add(Number.POSITIVE_INFINITY, 60, NOW)

    expect((await source.fetch(0, NOW)).incremental).toHaveLength(0)
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
      return { absolute: buckets, incremental: [] }
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

    const reading = await composite.fetch(at('2026-03-10', 0), NOW)
    // The device half stays absolute, the typed-in half stays incremental --
    // mixing them would either lose re-readability or double-count.
    expect(reading.absolute.reduce((sum, b) => sum + b.steps, 0)).toBe(800)
    expect(reading.incremental.reduce((sum, b) => sum + b.steps, 0)).toBe(200)
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

describe('late, backdated health data', () => {
  /**
   * The bug this pins down: Health Sync copies steps from Huawei Health into
   * Health Connect *backdated to when they were walked*, but does it minutes or
   * hours later. A forward-only sync watermark walks straight past them and the
   * steps are never seen again — 6,000 steps showing in Health Connect while the
   * game insists you walked 131.
   */
  const absolute = (buckets: StepBucket[]) => ({ absolute: buckets, incremental: [] })

  it('credits steps that appear in the store after the sync point moved past them', () => {
    let state = newGame(at('2026-03-10', 0), 777)
    state.dailyGoal = 1_000_000

    // 08:50 — only the earliest 131 steps have made it into the store yet.
    const morning = at('2026-03-10', 8, 50)
    const first = resolve(state, absolute([{ start: at('2026-03-10', 6), end: at('2026-03-10', 6, 30), steps: 131 }]), morning)
    state = first.state
    expect(first.report!.totalSteps).toBe(131)
    expect(state.lastSyncAt).toBe(morning)

    // 09:30 — the provider has now written the whole morning, all of it
    // timestamped *before* the sync point above.
    const later = at('2026-03-10', 9, 30)
    const second = resolve(
      state,
      absolute([
        { start: at('2026-03-10', 6), end: at('2026-03-10', 6, 30), steps: 131 },
        { start: at('2026-03-10', 7), end: at('2026-03-10', 8), steps: 3000 },
        { start: at('2026-03-10', 8), end: at('2026-03-10', 8, 45), steps: 3000 },
      ]),
      later,
    )

    // Everything after the first 131 gets credited, and nothing twice.
    expect(second.report!.totalSteps).toBe(6000)
    expect(second.state.history.find((d) => d.date === '2026-03-10')!.steps).toBe(6131)
  })

  it('is idempotent — re-reading the same window credits nothing further', () => {
    let state = newGame(at('2026-03-10', 0), 777)
    state.dailyGoal = 1_000_000
    const buckets = [{ start: at('2026-03-10', 7), end: at('2026-03-10', 8), steps: 4000 }]

    state = resolve(state, absolute(buckets), at('2026-03-10', 12)).state
    const again = resolve(state, absolute(buckets), at('2026-03-10', 13))

    expect(again.report).toBeNull()
    expect(again.state.history.find((d) => d.date === '2026-03-10')!.steps).toBe(4000)
  })

  it('never lets a provider that lost its history erase progress', () => {
    let state = newGame(at('2026-03-10', 0), 777)
    state.dailyGoal = 1_000_000

    state = resolve(state, absolute([{ start: at('2026-03-10', 7), end: at('2026-03-10', 8), steps: 5000 }]), at('2026-03-10', 12)).state
    const paces = state.expedition.paces

    // Health Connect comes back reporting far less for the same day.
    const shrunk = resolve(state, absolute([{ start: at('2026-03-10', 7), end: at('2026-03-10', 8), steps: 20 }]), at('2026-03-10', 13))

    expect(shrunk.state.history.find((d) => d.date === '2026-03-10')!.steps).toBe(5000)
    expect(shrunk.state.expedition.paces).toBe(paces)
  })

  it('adds manual entries on top of a device day without double counting', () => {
    let state = newGame(at('2026-03-10', 0), 777)
    state.dailyGoal = 1_000_000

    state = resolve(state, absolute([{ start: at('2026-03-10', 7), end: at('2026-03-10', 8), steps: 2000 }]), at('2026-03-10', 12)).state

    const mixed = resolve(
      state,
      {
        absolute: [{ start: at('2026-03-10', 7), end: at('2026-03-10', 8), steps: 2000 }],
        incremental: [{ start: at('2026-03-10', 12, 30), end: at('2026-03-10', 13), steps: 500 }],
      },
      at('2026-03-10', 13),
    )

    expect(mixed.report!.totalSteps).toBe(500)
    expect(mixed.state.history.find((d) => d.date === '2026-03-10')!.steps).toBe(2500)
  })
})
