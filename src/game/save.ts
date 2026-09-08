/** Creating, validating and serialising the save. */

import { TUNING } from './content'
import { generateExpedition } from './generate'
import { emptyCamp } from './meta'
import { randomSeed } from './rng'
import { dayKey, startOfDay } from './time'
import { SAVE_VERSION } from './types'
import type { Camp, GameState, Party, Stats } from './types'

export const DEFAULT_DAILY_GOAL = 6000

function newParty(): Party {
  return {
    hp: TUNING.baseMaxHp,
    baseMaxHp: TUNING.baseMaxHp,
    baseAtk: TUNING.baseAtk,
    baseDef: TUNING.baseDef,
    gear: { weapon: null, armor: null, trinket: null },
  }
}

function newStats(): Stats {
  return {
    totalSteps: 0,
    expeditionsCompleted: 0,
    deaths: 0,
    bestDaySteps: 0,
    currentStreak: 0,
    bestStreak: 0,
    enemiesDefeated: 0,
  }
}

export function newGame(now: number = Date.now(), seed: number = randomSeed()): GameState {
  return {
    version: SAVE_VERSION,
    seed,
    createdAt: now,
    // Start from local midnight so a brand-new save immediately credits the
    // steps already taken today, rather than showing an empty road until the
    // player next stands up.
    lastSyncAt: startOfDay(dayKey(now)),
    dailyGoal: DEFAULT_DAILY_GOAL,
    runCounter: 1,
    party: newParty(),
    expedition: generateExpedition(seed, 1, 1),
    camp: emptyCamp(),
    history: [],
    stats: newStats(),
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const int = (v: unknown, fallback: number): number => Math.round(num(v, fallback))

/**
 * Parse an untrusted save.
 *
 * Returns `null` only when the data is unusable — a missing expedition, say.
 * Anything merely odd (a negative stat, an unknown building) is repaired,
 * because silently starting a player over is worse than a slightly wrong number.
 */
export function parseState(raw: unknown, now: number = Date.now()): GameState | null {
  if (!isObj(raw)) return null
  if (!isObj(raw.expedition) || !isObj(raw.party) || !isObj(raw.camp)) return null

  const seed = int(raw.seed, randomSeed()) >>> 0
  const fresh = newGame(now, seed)

  const rawCamp = raw.camp as Record<string, unknown>
  const rawBuildings = isObj(rawCamp.buildings) ? rawCamp.buildings : {}
  const camp: Camp = {
    salvage: Math.max(0, int(rawCamp.salvage, 0)),
    buildings: {
      hearth: Math.max(0, int(rawBuildings.hearth, 0)),
      armory: Math.max(0, int(rawBuildings.armory, 0)),
      palisade: Math.max(0, int(rawBuildings.palisade, 0)),
      cartographer: Math.max(0, int(rawBuildings.cartographer, 0)),
      warehouse: Math.max(0, int(rawBuildings.warehouse, 0)),
    },
  }

  const rawParty = raw.party as Record<string, unknown>
  const rawGear = isObj(rawParty.gear) ? rawParty.gear : {}
  const party: Party = {
    hp: Math.max(0, int(rawParty.hp, fresh.party.hp)),
    baseMaxHp: Math.max(1, int(rawParty.baseMaxHp, TUNING.baseMaxHp)),
    baseAtk: Math.max(1, int(rawParty.baseAtk, TUNING.baseAtk)),
    baseDef: Math.max(0, int(rawParty.baseDef, TUNING.baseDef)),
    gear: {
      weapon: parseGear(rawGear.weapon),
      armor: parseGear(rawGear.armor),
      trinket: parseGear(rawGear.trinket),
    },
  }

  const rawExp = raw.expedition as Record<string, unknown>
  if (!Array.isArray(rawExp.route) || rawExp.route.length === 0) return null

  const route = rawExp.route.filter(isObj).map((n) => ({
    id: String(n.id ?? ''),
    kind: n.kind as GameState['expedition']['route'][number]['kind'],
    atPace: num(n.atPace, 0),
    ...(typeof n.enemyId === 'string' ? { enemyId: n.enemyId } : {}),
  }))
  if (route.length === 0) return null

  const expedition: GameState['expedition'] = {
    id: String(rawExp.id ?? fresh.expedition.id),
    seed: int(rawExp.seed, fresh.expedition.seed) >>> 0,
    biomeId: String(rawExp.biomeId ?? fresh.expedition.biomeId),
    depth: Math.max(1, int(rawExp.depth, 1)),
    paces: Math.max(0, num(rawExp.paces, 0)),
    length: Math.max(1, num(rawExp.length, fresh.expedition.length)),
    route,
    nextNodeIndex: Math.min(Math.max(0, int(rawExp.nextNodeIndex, 0)), route.length),
    salvage: Math.max(0, int(rawExp.salvage, 0)),
  }

  const rawStats = isObj(raw.stats) ? raw.stats : {}
  const stats: Stats = {
    totalSteps: Math.max(0, int(rawStats.totalSteps, 0)),
    expeditionsCompleted: Math.max(0, int(rawStats.expeditionsCompleted, 0)),
    deaths: Math.max(0, int(rawStats.deaths, 0)),
    bestDaySteps: Math.max(0, int(rawStats.bestDaySteps, 0)),
    currentStreak: Math.max(0, int(rawStats.currentStreak, 0)),
    bestStreak: Math.max(0, int(rawStats.bestStreak, 0)),
    enemiesDefeated: Math.max(0, int(rawStats.enemiesDefeated, 0)),
  }

  const history = Array.isArray(raw.history)
    ? raw.history
        .filter(isObj)
        .filter((d) => typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
        .map((d) => ({
          date: d.date as string,
          steps: Math.max(0, int(d.steps, 0)),
          bestBoutSteps: Math.max(0, int(d.bestBoutSteps, 0)),
          dawnSteps: Math.max(0, int(d.dawnSteps, 0)),
          duskSteps: Math.max(0, int(d.duskSteps, 0)),
          trained: d.trained === true,
        }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    : []

  return {
    version: SAVE_VERSION,
    seed,
    createdAt: int(raw.createdAt, now),
    // Never trust a stored sync point from the future — that would silently
    // swallow every step until the clock caught up.
    lastSyncAt: Math.min(int(raw.lastSyncAt, fresh.lastSyncAt), now),
    dailyGoal: Math.max(100, int(raw.dailyGoal, DEFAULT_DAILY_GOAL)),
    runCounter: Math.max(1, int(raw.runCounter, 1)),
    party,
    expedition,
    camp,
    history,
    stats,
  }
}

function parseGear(raw: unknown): GameState['party']['gear']['weapon'] {
  if (!isObj(raw)) return null
  const slot = raw.slot
  if (slot !== 'weapon' && slot !== 'armor' && slot !== 'trinket') return null
  const rarity = raw.rarity
  const validRarity =
    rarity === 'common' || rarity === 'fine' || rarity === 'rare' || rarity === 'relic'
  return {
    id: String(raw.id ?? 'g?'),
    name: String(raw.name ?? 'Unknown'),
    slot,
    rarity: validRarity ? rarity : 'common',
    atk: Math.max(0, int(raw.atk, 0)),
    def: Math.max(0, int(raw.def, 0)),
    hp: Math.max(0, int(raw.hp, 0)),
  }
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export function exportState(state: GameState): string {
  return JSON.stringify(state, null, 2)
}

export function importState(json: string, now: number = Date.now()): GameState | null {
  try {
    return parseState(JSON.parse(json), now)
  } catch {
    return null
  }
}
