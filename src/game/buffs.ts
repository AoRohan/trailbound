/**
 * Buffs are derived, never stored.
 *
 * Every one is recomputed from the day's own record plus history, which means
 * there is no expiry bookkeeping, no way for a buff to get stuck on, and
 * re-resolving the same day always produces the same modifiers.
 *
 * They are also the answer to "reward me for walking to the gym" without ever
 * touching location: a sustained 30-minute burst of steps looks nothing like a
 * day of wandering around a kitchen, and the clock tells us the rest.
 */

import { BUFFS, TUNING } from './content'
import { bestDayBefore, computeStreak } from './normalize'
import type { AppliedBuff, BuffId, BuffTotals, DayRecord } from './types'

export type { AppliedBuff, BuffTotals }

/** Minimum dawn/dusk steps before those buffs trigger. */
const TIME_OF_DAY_THRESHOLD = 500
/** Streak length at which Wayfarer starts paying out. */
const WAYFARER_MIN_STREAK = 3
/** Streak days beyond which Wayfarer stops growing. */
const WAYFARER_CAP = 14

export interface BuffContext {
  history: readonly DayRecord[]
  dailyGoal: number
}

export function computeDayBuffs(day: DayRecord, ctx: BuffContext): AppliedBuff[] {
  const applied: AppliedBuff[] = []
  const add = (id: BuffId, detail: string, overrides: Partial<BuffTotals> = {}) => {
    const def = BUFFS[id]
    applied.push({
      id,
      name: def.name,
      icon: def.icon,
      description: def.description,
      detail,
      paceMultiplier: overrides.paceMultiplier ?? def.paceMultiplier,
      atkBonus: overrides.atkBonus ?? def.atkBonus,
      defBonus: overrides.defBonus ?? def.defBonus,
      salvageMultiplier: overrides.salvageMultiplier ?? def.salvageMultiplier,
      lootLuck: overrides.lootLuck ?? def.lootLuck,
    })
  }

  if (day.bestBoutSteps >= TUNING.boutThreshold) {
    add('forcedMarch', `${Math.round(day.bestBoutSteps)} steps in half an hour`)
  }

  const streak = computeStreak(ctx.history, ctx.dailyGoal, day.date)
  if (streak >= WAYFARER_MIN_STREAK) {
    const effective = Math.min(streak, WAYFARER_CAP)
    add('wayfarer', `${streak} day streak`, {
      paceMultiplier: 1 + 0.02 * effective,
      defBonus: Math.min(Math.floor(effective / 3), 5),
    })
  }

  if (day.dawnSteps >= TIME_OF_DAY_THRESHOLD) {
    add('dawnWalk', `${Math.round(day.dawnSteps)} steps before 09:00`)
  }

  if (day.duskSteps >= TIME_OF_DAY_THRESHOLD) {
    add('duskWalk', `${Math.round(day.duskSteps)} steps after 20:00`)
  }

  // A personal best only counts once the day is also a real day — otherwise the
  // very first 40-step day in a fresh save would crown itself.
  const previousBest = bestDayBefore(ctx.history, day.date)
  if (day.steps > previousBest && day.steps >= ctx.dailyGoal) {
    add('personalBest', `${day.steps} steps — previous best ${previousBest}`)
  }

  if (day.trained) {
    add('ironBody', 'Training session logged')
  }

  return applied
}

/** Multipliers multiply, bonuses add. */
export function combineBuffs(buffs: readonly AppliedBuff[]): BuffTotals {
  const totals: BuffTotals = {
    paceMultiplier: 1,
    atkBonus: 0,
    defBonus: 0,
    salvageMultiplier: 1,
    lootLuck: 0,
  }

  for (const buff of buffs) {
    totals.paceMultiplier *= buff.paceMultiplier
    totals.atkBonus += buff.atkBonus
    totals.defBonus += buff.defBonus
    totals.salvageMultiplier *= buff.salvageMultiplier
    totals.lootLuck += buff.lootLuck
  }

  return totals
}

/** Everything the player could earn, for the "how do I get buffs" screen. */
export function allBuffDefs() {
  return Object.values(BUFFS)
}
