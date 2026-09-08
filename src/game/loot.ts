/** Gear generation and the auto-equip rule. */

import { GEAR_NAMES, GEAR_PREFIXES, GEAR_SLOT_WEIGHTS, RARITIES } from './content'
import { powerScore } from './stats'
import type { Rng } from './rng'
import type { Gear, GearSlot, Rarity } from './types'

const SLOTS: GearSlot[] = ['weapon', 'armor', 'trinket']

/** Base rarity weights. Luck lifts the tail without ever making commons rare. */
const RARITY_BASE: Record<Rarity, number> = {
  common: 62,
  fine: 26,
  rare: 10,
  relic: 2,
}

/** How strongly `lootLuck` amplifies each tier. */
const RARITY_LUCK_GAIN: Record<Rarity, number> = {
  common: 0,
  fine: 2,
  rare: 5,
  relic: 12,
}

export function rollRarity(rng: Rng, luck: number): Rarity {
  const clampedLuck = Math.max(0, Math.min(luck, 1))
  const weights = (Object.keys(RARITY_BASE) as Rarity[]).map((rarity) => ({
    item: rarity,
    weight: RARITY_BASE[rarity] * (1 + RARITY_LUCK_GAIN[rarity] * clampedLuck),
  }))
  return rng.weighted(weights)
}

export function generateGear(
  rng: Rng,
  depth: number,
  luck: number,
  forcedSlot?: GearSlot,
): Gear {
  const slot = forcedSlot ?? rng.pick(SLOTS)
  const rarity = rollRarity(rng, luck)
  const weights = GEAR_SLOT_WEIGHTS[slot]
  const mult = RARITIES[rarity].mult
  const depthScale = 1 + 0.35 * Math.max(0, depth - 1)

  const roll = (base: number) =>
    base === 0 ? 0 : Math.max(0, Math.round(base * mult * depthScale * rng.float(0.85, 1.15)))

  const prefix = rng.pick(GEAR_PREFIXES[rarity])
  const noun = rng.pick(GEAR_NAMES[slot])

  return {
    id: `g${rng.int(0, 0x7fffffff).toString(36)}`,
    name: `${prefix} ${noun}`,
    slot,
    rarity,
    atk: roll(weights.atk),
    def: roll(weights.def),
    hp: roll(weights.hp),
  }
}

export function gearPower(gear: Gear): number {
  return powerScore(gear.atk, gear.def, gear.hp)
}

/** Auto-equip keeps whatever is strictly stronger; ties keep the current item. */
export function shouldEquip(current: Gear | null, candidate: Gear): boolean {
  if (!current) return true
  return gearPower(candidate) > gearPower(current)
}
