/**
 * The core. Steps in, world state and a story out.
 *
 * `resolve` is pure: same state + same buckets + same `now` produces byte-identical
 * results, because every random decision derives its stream from the save seed and
 * a stable context string. That is what makes the whole game testable on a laptop
 * with no phone attached — which matters, because the phone is the one thing I
 * cannot run.
 *
 * The shape of a resolution:
 *   1. sanitize + bucket the raw steps into local days
 *   2. for each day, oldest first: work out that day's buffs, convert steps to
 *      paces, and walk the party that far
 *   3. resolve every node crossed, in order, appending to the log
 *   4. when a run ends (death or a dead boss), bank salvage and set off again —
 *      leftover paces carry into the new road, so a long walk is never wasted
 */

import { simulateCombat } from './combat'
import { TUNING, biomeById, biomeForDepth } from './content'
import { combineBuffs, computeDayBuffs } from './buffs'
import { generateExpedition, scaleEnemy } from './generate'
import { generateGear, gearPower, shouldEquip } from './loot'
import {
  bucketsToDayRecords,
  computeStreak,
  mergeDayRecords,
  sanitizeBuckets,
  splitAtHourBoundaries,
} from './normalize'
import { rngFor } from './rng'
import { campPaceMultiplier, campSalvageMultiplier, derivedStats } from './stats'
import { dayKey } from './time'
import type { BuffTotals, GameState, LogEntry, Report, RouteNode, StepBucket } from './types'

export interface ResolveResult {
  state: GameState
  /** `null` when nothing was credited — no steps, nothing to show. */
  report: Report | null
}

interface Ctx {
  state: GameState
  entries: LogEntry[]
  buffs: BuffTotals
  /** Set by a node resolution when the current run is over. */
  runEnded: 'death' | 'complete' | null
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function resolve(
  state: GameState,
  buckets: readonly StepBucket[],
  now: number = Date.now(),
): ResolveResult {
  const from = state.lastSyncAt

  const clean = splitAtHourBoundaries(sanitizeBuckets(buckets, from, now))
  const incoming = bucketsToDayRecords(clean)
  const { history, creditedByDay } = mergeDayRecords(state.history, incoming)

  const next: GameState = structuredClone(state)
  next.history = history
  // Advance the sync point even when nothing was credited, so a quiet hour is
  // not re-scanned forever.
  next.lastSyncAt = Math.max(from, now)

  if (creditedByDay.size === 0) {
    refreshStats(next, now)
    return { state: next, report: null }
  }

  const ctx: Ctx = {
    state: next,
    entries: [],
    buffs: neutralBuffs(),
    runEnded: null,
  }

  let totalSteps = 0
  let totalPaces = 0

  const days = [...creditedByDay.keys()].sort()
  for (const date of days) {
    const credited = creditedByDay.get(date) ?? 0
    if (credited <= 0) continue

    const record = next.history.find((d) => d.date === date)
    if (!record) continue

    const applied = computeDayBuffs(record, {
      history: next.history,
      dailyGoal: next.dailyGoal,
    })
    ctx.buffs = combineBuffs(applied)

    const paces = Math.round(
      credited * TUNING.pacesPerStep * ctx.buffs.paceMultiplier * campPaceMultiplier(next.camp),
    )

    ctx.entries.push({ t: 'day', date, steps: credited, paces, buffs: applied })

    totalSteps += credited
    totalPaces += paces

    advance(ctx, paces)
  }

  next.stats.totalSteps += totalSteps
  refreshStats(next, now)

  return {
    state: next,
    report: { from, to: now, totalSteps, totalPaces, entries: ctx.entries },
  }
}

function neutralBuffs(): BuffTotals {
  return {
    paceMultiplier: 1,
    atkBonus: 0,
    defBonus: 0,
    salvageMultiplier: 1,
    lootLuck: 0,
  }
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function advance(ctx: Ctx, paces: number): void {
  let remaining = paces
  let guard = 0

  while (remaining > 0 && guard++ < TUNING.maxNodesPerResolve) {
    const exp = ctx.state.expedition
    const node = exp.route[exp.nextNodeIndex]

    if (!node) {
      // Route exhausted without an end condition. Shouldn't happen — the boss
      // always sits at the final pace — but walk it out rather than spin.
      exp.paces = Math.min(exp.paces + remaining, exp.length)
      return
    }

    const gap = node.atPace - exp.paces
    if (gap > remaining) {
      exp.paces += remaining
      return
    }

    exp.paces = node.atPace
    remaining -= gap
    exp.nextNodeIndex++

    resolveNode(ctx, node)

    if (ctx.runEnded) {
      endRun(ctx, ctx.runEnded)
      ctx.runEnded = null
    }
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function resolveNode(ctx: Ctx, node: RouteNode): void {
  const { state } = ctx
  const rng = rngFor(state.seed, node.id)

  switch (node.kind) {
    case 'encounter':
    case 'boss': {
      const isBoss = node.kind === 'boss'
      const biome = biomeById(state.expedition.biomeId)
      const enemy = scaleEnemy(
        node.enemyId ?? biome.enemyIds[0]!,
        state.expedition.depth,
        biome.difficulty,
      )

      const stats = derivedStats(state.party, state.camp, ctx.buffs)
      const result = simulateCombat(
        rng,
        { hp: state.party.hp, atk: stats.atk, def: stats.def },
        enemy,
      )
      state.party.hp = result.partyHp

      let salvage = 0
      if (result.won) {
        salvage = Math.round(
          enemy.salvage * ctx.buffs.salvageMultiplier * campSalvageMultiplier(state.camp),
        )
        state.expedition.salvage += salvage
        state.stats.enemiesDefeated++
      }

      ctx.entries.push({
        t: 'combat',
        nodeId: node.id,
        enemyName: enemy.name,
        enemyIcon: enemy.icon,
        isBoss,
        rounds: result.rounds,
        won: result.won,
        partyHpAfter: result.partyHp,
        salvage,
      })

      if (!result.won) {
        ctx.runEnded = 'death'
        return
      }

      // Bosses always pay out; ordinary fights sometimes do.
      const dropChance = isBoss ? 1 : 0.3 + ctx.buffs.lootLuck
      if (rng.chance(dropChance)) awardGear(ctx, node.id, rng)

      if (isBoss) ctx.runEnded = 'complete'
      return
    }

    case 'cache': {
      const depthScale = 1 + 0.15 * (state.expedition.depth - 1)
      const salvage = Math.round(
        rng.int(10, 26) *
          depthScale *
          ctx.buffs.salvageMultiplier *
          campSalvageMultiplier(state.camp),
      )
      state.expedition.salvage += salvage
      ctx.entries.push({ t: 'cache', nodeId: node.id, salvage })

      if (rng.chance(0.35 + ctx.buffs.lootLuck)) awardGear(ctx, node.id, rng)
      return
    }

    case 'shrine': {
      const healed = healParty(ctx, 0.35)
      ctx.entries.push({
        t: 'shrine',
        nodeId: node.id,
        healed,
        partyHpAfter: state.party.hp,
      })
      return
    }

    case 'rest': {
      const healed = healParty(ctx, 0.2)
      ctx.entries.push({
        t: 'rest',
        nodeId: node.id,
        healed,
        partyHpAfter: state.party.hp,
      })
      return
    }
  }
}

function healParty(ctx: Ctx, fraction: number): number {
  const { state } = ctx
  const { maxHp } = derivedStats(state.party, state.camp, ctx.buffs)
  const before = state.party.hp
  state.party.hp = Math.min(maxHp, before + Math.round(maxHp * fraction))
  return state.party.hp - before
}

function awardGear(ctx: Ctx, nodeId: string, rng: ReturnType<typeof rngFor>): void {
  const { state } = ctx
  const gear = generateGear(rng, state.expedition.depth, ctx.buffs.lootLuck)
  const current = state.party.gear[gear.slot]

  if (shouldEquip(current, gear)) {
    state.party.gear[gear.slot] = gear
    // A bigger pack raises the ceiling but never tops you up for free.
    const { maxHp } = derivedStats(state.party, state.camp, ctx.buffs)
    state.party.hp = Math.min(state.party.hp, maxHp)
    ctx.entries.push({
      t: 'loot',
      nodeId,
      gear,
      replaced: current,
      kept: true,
      salvage: 0,
    })
    return
  }

  // Worse than what we carry — break it down rather than making the player
  // read about an item they'll never use.
  const salvage = Math.max(
    1,
    Math.round(gearPower(gear) * 0.5 * campSalvageMultiplier(state.camp)),
  )
  state.expedition.salvage += salvage
  ctx.entries.push({ t: 'loot', nodeId, gear, replaced: null, kept: false, salvage })
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function endRun(ctx: Ctx, reason: 'death' | 'complete'): void {
  const { state } = ctx
  const biome = biomeById(state.expedition.biomeId)
  const depth = state.expedition.depth

  if (reason === 'death') {
    const banked = Math.round(state.expedition.salvage * TUNING.deathSalvageKept)
    state.camp.salvage += banked
    state.stats.deaths++
    ctx.entries.push({ t: 'death', biomeName: biome.name, depth, salvageBanked: banked })
    startExpedition(ctx, depth)
    return
  }

  const bonus = Math.round(
    TUNING.completionBonus *
      (1 + 0.25 * (depth - 1)) *
      ctx.buffs.salvageMultiplier *
      campSalvageMultiplier(state.camp),
  )
  const banked = state.expedition.salvage + bonus
  state.camp.salvage += banked
  state.stats.expeditionsCompleted++
  ctx.entries.push({
    t: 'complete',
    biomeName: biome.name,
    depth,
    salvageBanked: banked,
    bonus,
  })
  startExpedition(ctx, depth + 1)
}

/**
 * Set off again. The party always leaves camp at full health — this game is
 * driven by real walking, so there is no way to grind back a bad run, and a
 * death spiral would just make the app something you stop opening.
 */
function startExpedition(ctx: Ctx, depth: number): void {
  const { state } = ctx
  state.runCounter++
  state.expedition = generateExpedition(state.seed, depth, state.runCounter)
  state.party.hp = derivedStats(state.party, state.camp, ctx.buffs).maxHp

  const biome = biomeForDepth(depth)
  ctx.entries.push({
    t: 'depart',
    biomeName: biome.name,
    depth,
    length: state.expedition.length,
  })
}

// ---------------------------------------------------------------------------
// Derived stats
// ---------------------------------------------------------------------------

function refreshStats(state: GameState, now: number): void {
  let best = 0
  for (const record of state.history) {
    if (record.steps > best) best = record.steps
  }
  state.stats.bestDaySteps = best

  const streak = computeStreak(state.history, state.dailyGoal, dayKey(now))
  state.stats.currentStreak = streak
  state.stats.bestStreak = Math.max(state.stats.bestStreak, streak)
}

// ---------------------------------------------------------------------------
// Manual actions
// ---------------------------------------------------------------------------

/**
 * Toggle today's "I trained" check-in.
 *
 * Honour system, and deliberately so: this is a single-player game with no
 * leaderboard, so the only person a false check-in cheats is the person
 * pressing the button. It is the location-free stand-in for "I went to the gym".
 */
export function setTrainedToday(state: GameState, trained: boolean, now: number = Date.now()): GameState {
  const date = dayKey(now)
  const next: GameState = structuredClone(state)
  const existing = next.history.find((d) => d.date === date)

  if (existing) {
    existing.trained = trained
  } else {
    next.history.push({
      date,
      steps: 0,
      bestBoutSteps: 0,
      dawnSteps: 0,
      duskSteps: 0,
      trained,
    })
    next.history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }

  return next
}
