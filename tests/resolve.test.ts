import { describe, expect, it } from 'vitest'
import { resolve, setTrainedToday } from '../src/game/resolve'
import { newGame } from '../src/game/save'
import { derivedStats } from '../src/game/stats'
import { TUNING } from '../src/game/content'
import type { GameState, LogEntry } from '../src/game/types'
import { at, dayOfSteps, hourBucket } from './helpers'

const SEED = 20260310

/**
 * A save with an unreachable daily goal, so no streak or personal-best buff can
 * fire and `paces === steps` exactly. Makes distance assertions readable.
 */
function plainState(date = '2026-03-10', seed = SEED): GameState {
  const state = newGame(at(date, 0), seed)
  state.dailyGoal = 1_000_000
  return state
}

/** Maxed combat buildings — strong enough to clear the first biome outright. */
function veteranState(date = '2026-03-10', seed = SEED): GameState {
  const state = plainState(date, seed)
  state.camp.buildings = {
    hearth: 10,
    armory: 10,
    palisade: 8,
    cartographer: 0, // left at 0 so paces still equal steps
    warehouse: 0,
  }
  state.party.hp = derivedStats(state.party, state.camp).maxHp
  return state
}

const entriesOfType = <T extends LogEntry['t']>(entries: LogEntry[], t: T) =>
  entries.filter((e): e is Extract<LogEntry, { t: T }> => e.t === t)

describe('resolve — crediting steps', () => {
  it('converts steps to paces one-for-one with no buffs or camp bonuses', () => {
    const state = plainState()
    const { state: after, report } = resolve(state, dayOfSteps('2026-03-10', 400), at('2026-03-10', 20))

    expect(report).not.toBeNull()
    expect(report!.totalSteps).toBe(400)
    expect(report!.totalPaces).toBe(400)
    expect(after.expedition.paces).toBe(400)
  })

  it('returns no report when there are no steps, but still advances the sync point', () => {
    const state = plainState()
    const now = at('2026-03-10', 20)
    const { state: after, report } = resolve(state, [], now)

    expect(report).toBeNull()
    expect(after.lastSyncAt).toBe(now)
  })

  it('never credits the same steps twice', () => {
    const state = plainState()
    const buckets = dayOfSteps('2026-03-10', 900)
    const now = at('2026-03-10', 20)

    const first = resolve(state, buckets, now)
    const second = resolve(first.state, buckets, now)

    expect(first.report!.totalSteps).toBe(900)
    expect(second.report).toBeNull()
    expect(second.state.expedition.paces).toBe(first.state.expedition.paces)
  })

  it('credits only the new part when a bucket is re-sent with more steps in it', () => {
    const state = plainState()
    // Sync mid-hour, then re-send the full hour.
    const partial = resolve(state, [hourBucket('2026-03-10', 10, 600)], at('2026-03-10', 10, 30))
    expect(partial.report!.totalSteps).toBe(300)

    const rest = resolve(partial.state, [hourBucket('2026-03-10', 10, 600)], at('2026-03-10', 11))
    expect(rest.report!.totalSteps).toBe(300)
  })

  it('honours the daily step cap', () => {
    const state = plainState()
    const { report } = resolve(
      state,
      dayOfSteps('2026-03-10', TUNING.maxCreditedStepsPerDay + 25_000),
      at('2026-03-10', 23),
    )
    expect(report!.totalSteps).toBe(TUNING.maxCreditedStepsPerDay)
  })

  it('ignores steps timestamped in the future', () => {
    const state = plainState()
    const { report } = resolve(state, dayOfSteps('2026-03-15', 5000), at('2026-03-10', 20))
    expect(report).toBeNull()
  })
})

describe('resolve — determinism', () => {
  it('produces identical results for identical inputs', () => {
    const buckets = dayOfSteps('2026-03-10', 9000)
    const now = at('2026-03-10', 22)

    const a = resolve(plainState(), buckets, now)
    const b = resolve(plainState(), buckets, now)

    expect(a.state).toEqual(b.state)
    expect(a.report).toEqual(b.report)
  })

  it('produces different roads for different seeds', () => {
    const a = plainState('2026-03-10', 1)
    const b = plainState('2026-03-10', 2)
    expect(a.expedition.route.map((n) => n.atPace)).not.toEqual(
      b.expedition.route.map((n) => n.atPace),
    )
  })
})

describe('resolve — multiple days', () => {
  it('resolves days oldest first and logs one day entry each', () => {
    const state = plainState('2026-03-08')
    const buckets = [
      ...dayOfSteps('2026-03-08', 300),
      ...dayOfSteps('2026-03-09', 300),
      ...dayOfSteps('2026-03-10', 300),
    ]
    const { state: after, report } = resolve(state, buckets, at('2026-03-10', 22))

    const days = entriesOfType(report!.entries, 'day')
    expect(days.map((d) => d.date)).toEqual(['2026-03-08', '2026-03-09', '2026-03-10'])
    expect(report!.totalSteps).toBe(900)
    expect(after.expedition.paces).toBe(900)
    expect(after.history).toHaveLength(3)
  })

  it('applies each day its own buffs', () => {
    const state = newGame(at('2026-03-08', 0), SEED)
    state.dailyGoal = 6000
    const buckets = [
      ...dayOfSteps('2026-03-08', 7000),
      ...dayOfSteps('2026-03-09', 7000),
      ...dayOfSteps('2026-03-10', 7000),
    ]
    const { report } = resolve(state, buckets, at('2026-03-10', 22))
    const days = entriesOfType(report!.entries, 'day')

    // Day one sets a personal best; by day three the streak is live.
    expect(days[0]!.buffs.map((b) => b.id)).toContain('personalBest')
    expect(days[2]!.buffs.map((b) => b.id)).toContain('wayfarer')
  })
})

describe('resolve — buffs', () => {
  it('grants Forced March for a sustained burst', () => {
    const state = plainState()
    const buckets = [hourBucket('2026-03-10', 12, 3000)] // 1500 in any half hour
    const { report } = resolve(state, buckets, at('2026-03-10', 20))

    const day = entriesOfType(report!.entries, 'day')[0]!
    expect(day.buffs.map((b) => b.id)).toContain('forcedMarch')
    // 15% pace bonus applied.
    expect(day.paces).toBe(Math.round(3000 * 1.15))
  })

  it('grants dawn and dusk buffs from the clock alone', () => {
    const state = plainState()
    const buckets = [hourBucket('2026-03-10', 6, 600), hourBucket('2026-03-10', 21, 600)]
    const { report } = resolve(state, buckets, at('2026-03-10', 23))

    const ids = entriesOfType(report!.entries, 'day')[0]!.buffs.map((b) => b.id)
    expect(ids).toContain('dawnWalk')
    expect(ids).toContain('duskWalk')
  })

  it('grants Iron Body after a manual training check-in', () => {
    let state = plainState()
    state = setTrainedToday(state, true, at('2026-03-10', 9))

    const { report } = resolve(state, dayOfSteps('2026-03-10', 800), at('2026-03-10', 20))
    const day = entriesOfType(report!.entries, 'day')[0]!

    expect(day.buffs.map((b) => b.id)).toContain('ironBody')
    expect(day.paces).toBe(Math.round(800 * 1.1))
  })

  it('applies the Cartographer on top of buffs', () => {
    const state = plainState()
    state.camp.buildings.cartographer = 5 // +20%
    const { report } = resolve(state, dayOfSteps('2026-03-10', 1000), at('2026-03-10', 20))
    expect(report!.totalPaces).toBe(1200)
  })
})

describe('resolve — run lifecycle', () => {
  it('completes a biome, banks salvage, and moves to the next depth', () => {
    const state = veteranState()
    const length = state.expedition.length
    const { state: after, report } = resolve(
      state,
      dayOfSteps('2026-03-10', length + 2000),
      at('2026-03-10', 23),
    )

    const completions = entriesOfType(report!.entries, 'complete')
    expect(completions).toHaveLength(1)
    expect(after.stats.expeditionsCompleted).toBe(1)
    expect(after.expedition.depth).toBe(2)
    expect(after.camp.salvage).toBeGreaterThan(0)
  })

  it('carries leftover paces into the next expedition', () => {
    const state = veteranState()
    const length = state.expedition.length
    const { state: after } = resolve(
      state,
      dayOfSteps('2026-03-10', length + 2000),
      at('2026-03-10', 23),
    )

    // The 2000 steps past the boss keep the party walking on the new road.
    expect(after.expedition.depth).toBe(2)
    expect(after.expedition.paces).toBe(2000)
  })

  it('ends the run on death, keeps half the salvage, and retries the same depth', () => {
    const state = plainState()
    const firstEncounter = state.expedition.route.find((n) => n.kind === 'encounter')!
    state.party.hp = 1 // cannot survive any fight

    const { state: after, report } = resolve(
      state,
      dayOfSteps('2026-03-10', firstEncounter.atPace),
      at('2026-03-10', 23),
    )

    const deaths = entriesOfType(report!.entries, 'death')
    expect(deaths).toHaveLength(1)
    expect(after.stats.deaths).toBe(1)
    expect(after.expedition.depth).toBe(1) // same biome, second attempt
    expect(after.party.hp).toBeGreaterThan(0) // revived for the next road
  })

  it('generates a different road when retrying a depth after death', () => {
    const state = plainState()
    const before = state.expedition.route.map((n) => `${n.kind}@${n.atPace}`)
    const firstEncounter = state.expedition.route.find((n) => n.kind === 'encounter')!
    state.party.hp = 1

    const { state: after } = resolve(
      state,
      dayOfSteps('2026-03-10', firstEncounter.atPace),
      at('2026-03-10', 23),
    )

    expect(after.expedition.route.map((n) => `${n.kind}@${n.atPace}`)).not.toEqual(before)
  })

  it('logs a departure whenever a new expedition begins', () => {
    const state = veteranState()
    const { report } = resolve(
      state,
      dayOfSteps('2026-03-10', state.expedition.length + 500),
      at('2026-03-10', 23),
    )
    expect(entriesOfType(report!.entries, 'depart')).toHaveLength(1)
  })
})

describe('resolve — loot', () => {
  it('equips an upgrade and breaks down anything worse', () => {
    const state = veteranState()
    const { state: after, report } = resolve(
      state,
      dayOfSteps('2026-03-10', state.expedition.length),
      at('2026-03-10', 23),
    )

    const loot = entriesOfType(report!.entries, 'loot')
    expect(loot.length).toBeGreaterThan(0)

    // Something got equipped along the way.
    const equipped = Object.values(after.party.gear).filter(Boolean)
    expect(equipped.length).toBeGreaterThan(0)

    // Rejected items always return some salvage rather than vanishing.
    for (const entry of loot) {
      if (!entry.kept) expect(entry.salvage).toBeGreaterThan(0)
    }
  })

  it('never lets health exceed the maximum after a gear change', () => {
    const state = veteranState()
    const { state: after } = resolve(
      state,
      dayOfSteps('2026-03-10', state.expedition.length),
      at('2026-03-10', 23),
    )
    expect(after.party.hp).toBeLessThanOrEqual(derivedStats(after.party, after.camp).maxHp)
  })
})

describe('resolve — soak', () => {
  it('survives a year of walking with every invariant intact', () => {
    let state = plainState('2026-01-01')
    state.dailyGoal = 6000

    for (let i = 0; i < 365; i++) {
      const d = new Date(2026, 0, 1 + i)
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const steps = 4000 + ((i * 1327) % 9000) // varied but deterministic
      const result = resolve(state, dayOfSteps(date, steps), at(date, 23))
      state = result.state

      const { maxHp } = derivedStats(state.party, state.camp)
      expect(state.party.hp).toBeGreaterThan(0)
      expect(state.party.hp).toBeLessThanOrEqual(maxHp)
      expect(state.expedition.paces).toBeGreaterThanOrEqual(0)
      expect(state.expedition.paces).toBeLessThanOrEqual(state.expedition.length)
      expect(state.expedition.nextNodeIndex).toBeLessThanOrEqual(state.expedition.route.length)
      expect(state.camp.salvage).toBeGreaterThanOrEqual(0)
      expect(state.expedition.depth).toBeGreaterThanOrEqual(1)
      expect(Number.isFinite(state.camp.salvage)).toBe(true)
    }

    // A year of real walking should get somewhere.
    expect(state.expedition.depth).toBeGreaterThan(1)
    expect(state.stats.totalSteps).toBeGreaterThan(1_000_000)
    expect(state.history.length).toBeLessThanOrEqual(TUNING.historyDays)
  })
})

describe('setTrainedToday', () => {
  it('creates a record for a day with no steps yet', () => {
    const state = plainState()
    const after = setTrainedToday(state, true, at('2026-03-10', 9))
    expect(after.history.find((d) => d.date === '2026-03-10')?.trained).toBe(true)
  })

  it('can be toggled back off', () => {
    let state = plainState()
    state = setTrainedToday(state, true, at('2026-03-10', 9))
    state = setTrainedToday(state, false, at('2026-03-10', 9))
    expect(state.history.find((d) => d.date === '2026-03-10')?.trained).toBe(false)
  })
})
