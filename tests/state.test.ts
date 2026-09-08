import { describe, expect, it } from 'vitest'
import { DEFAULT_DAILY_GOAL, exportState, importState, newGame, parseState } from '../src/game/save'
import { campView, canAfford, emptyCamp, upgrade, upgradeCost } from '../src/game/meta'
import { BUILDINGS } from '../src/game/content'
import { makeRng, rngFor } from '../src/game/rng'
import { at } from './helpers'

const NOW = at('2026-03-10', 12)

describe('newGame', () => {
  it('starts the clock at local midnight so today already counts', () => {
    const state = newGame(NOW, 42)
    expect(state.lastSyncAt).toBe(at('2026-03-10', 0))
  })

  it('begins at depth 1 with a boss at the end of the road', () => {
    const state = newGame(NOW, 42)
    expect(state.expedition.depth).toBe(1)
    const last = state.expedition.route[state.expedition.route.length - 1]!
    expect(last.kind).toBe('boss')
    expect(last.atPace).toBe(state.expedition.length)
  })

  it('is reproducible from its seed', () => {
    expect(newGame(NOW, 7)).toEqual(newGame(NOW, 7))
  })
})

describe('parseState', () => {
  it('round-trips a real save', () => {
    const state = newGame(NOW, 99)
    const restored = importState(exportState(state), NOW)
    expect(restored).toEqual(state)
  })

  it('rejects data that is not a save at all', () => {
    expect(parseState(null, NOW)).toBeNull()
    expect(parseState('nope', NOW)).toBeNull()
    expect(parseState(42, NOW)).toBeNull()
    expect(parseState({}, NOW)).toBeNull()
    expect(parseState([], NOW)).toBeNull()
  })

  it('rejects a save with no route to walk', () => {
    const state = newGame(NOW, 99) as unknown as Record<string, unknown>
    const broken = { ...state, expedition: { ...(state.expedition as object), route: [] } }
    expect(parseState(broken, NOW)).toBeNull()
  })

  it('repairs nonsense values instead of discarding the save', () => {
    const state = JSON.parse(exportState(newGame(NOW, 99)))
    state.camp.salvage = -500
    state.stats.deaths = -3
    state.dailyGoal = 0
    state.party.hp = -10
    state.camp.buildings.hearth = 'seven'

    const parsed = parseState(state, NOW)!
    expect(parsed.camp.salvage).toBe(0)
    expect(parsed.stats.deaths).toBe(0)
    expect(parsed.dailyGoal).toBeGreaterThanOrEqual(100)
    expect(parsed.party.hp).toBe(0)
    expect(parsed.camp.buildings.hearth).toBe(0)
  })

  it('clamps a sync point set in the future', () => {
    const state = JSON.parse(exportState(newGame(NOW, 99)))
    state.lastSyncAt = at('2027-01-01', 0)
    expect(parseState(state, NOW)!.lastSyncAt).toBe(NOW)
  })

  it('drops malformed history entries and keeps good ones sorted', () => {
    const state = JSON.parse(exportState(newGame(NOW, 99)))
    state.history = [
      { date: '2026-03-10', steps: 100 },
      { date: 'not-a-date', steps: 100 },
      null,
      { date: '2026-03-08', steps: 200 },
    ]
    const parsed = parseState(state, NOW)!
    expect(parsed.history.map((d) => d.date)).toEqual(['2026-03-08', '2026-03-10'])
  })

  it('drops gear with an invalid slot', () => {
    const state = JSON.parse(exportState(newGame(NOW, 99)))
    state.party.gear.weapon = { id: 'x', name: 'Odd', slot: 'hat', rarity: 'rare', atk: 5 }
    expect(parseState(state, NOW)!.party.gear.weapon).toBeNull()
  })

  it('survives truncated JSON', () => {
    expect(importState('{"seed": 1, "party"', NOW)).toBeNull()
  })

  it('defaults the daily goal when it is missing', () => {
    const state = JSON.parse(exportState(newGame(NOW, 99)))
    delete state.dailyGoal
    expect(parseState(state, NOW)!.dailyGoal).toBe(DEFAULT_DAILY_GOAL)
  })
})

describe('camp upgrades', () => {
  it('charges the listed price and raises the level', () => {
    const camp = { ...emptyCamp(), salvage: 1000 }
    const cost = upgradeCost(camp, 'hearth')!
    const after = upgrade(camp, 'hearth')

    expect(after.buildings.hearth).toBe(1)
    expect(after.salvage).toBe(1000 - cost)
  })

  it('refuses a purchase you cannot afford, without mutating anything', () => {
    const camp = { ...emptyCamp(), salvage: 1 }
    expect(canAfford(camp, 'hearth')).toBe(false)
    expect(upgrade(camp, 'hearth')).toEqual(camp)
  })

  it('gets more expensive each level', () => {
    let camp = { ...emptyCamp(), salvage: 1_000_000 }
    const first = upgradeCost(camp, 'armory')!
    camp = upgrade(camp, 'armory')
    expect(upgradeCost(camp, 'armory')!).toBeGreaterThan(first)
  })

  it('stops at the maximum level', () => {
    let camp = { ...emptyCamp(), salvage: 100_000_000 }
    for (let i = 0; i < BUILDINGS.palisade.maxLevel + 5; i++) camp = upgrade(camp, 'palisade')

    expect(camp.buildings.palisade).toBe(BUILDINGS.palisade.maxLevel)
    expect(upgradeCost(camp, 'palisade')).toBeNull()
    expect(canAfford(camp, 'palisade')).toBe(false)
  })

  it('describes every building for the camp screen', () => {
    const view = campView({ ...emptyCamp(), salvage: 500 })
    expect(view).toHaveLength(5)
    for (const row of view) {
      expect(row.def.name).toBeTruthy()
      expect(row.nextEffect).toBeTruthy()
    }
  })
})

describe('rng', () => {
  it('is reproducible for a seed', () => {
    const a = makeRng(1234)
    const b = makeRng(1234)
    const draw = (r: ReturnType<typeof makeRng>) => [r.next(), r.int(1, 100), r.next()]
    expect(draw(a)).toEqual(draw(b))
  })

  it('gives different streams for different contexts', () => {
    const a = rngFor(1, 'alpha')
    const b = rngFor(1, 'beta')
    expect(a.next()).not.toBe(b.next())
  })

  it('stays inside the requested integer range', () => {
    const rng = makeRng(5)
    for (let i = 0; i < 2000; i++) {
      const value = rng.int(3, 7)
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThanOrEqual(7)
      expect(Number.isInteger(value)).toBe(true)
    }
  })

  it('respects weights', () => {
    const rng = makeRng(11)
    let heavy = 0
    for (let i = 0; i < 4000; i++) {
      if (rng.weighted([{ item: 'a', weight: 9 }, { item: 'b', weight: 1 }]) === 'a') heavy++
    }
    expect(heavy / 4000).toBeGreaterThan(0.85)
    expect(heavy / 4000).toBeLessThan(0.95)
  })

  it('refuses impossible draws rather than returning undefined', () => {
    const rng = makeRng(1)
    expect(() => rng.pick([])).toThrow()
    expect(() => rng.weighted([])).toThrow()
    expect(() => rng.weighted([{ item: 'x', weight: 0 }])).toThrow()
  })
})
