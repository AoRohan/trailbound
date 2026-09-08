/** Folding base stats, equipped gear, camp buildings and buffs into one place. */

import { BUILDING_EFFECTS } from './content'
import type { BuffTotals } from './buffs'
import type { Camp, DerivedStats, Party } from './types'

const NO_BUFFS: BuffTotals = {
  paceMultiplier: 1,
  atkBonus: 0,
  defBonus: 0,
  salvageMultiplier: 1,
  lootLuck: 0,
}

export function gearBonuses(party: Party): DerivedStats {
  let maxHp = 0
  let atk = 0
  let def = 0
  for (const slot of ['weapon', 'armor', 'trinket'] as const) {
    const item = party.gear[slot]
    if (!item) continue
    maxHp += item.hp
    atk += item.atk
    def += item.def
  }
  return { maxHp, atk, def }
}

export function derivedStats(
  party: Party,
  camp: Camp,
  buffs: BuffTotals = NO_BUFFS,
): DerivedStats {
  const gear = gearBonuses(party)
  return {
    maxHp:
      party.baseMaxHp + gear.maxHp + camp.buildings.hearth * BUILDING_EFFECTS.hearthHpPerLevel,
    atk:
      party.baseAtk + gear.atk + camp.buildings.armory * BUILDING_EFFECTS.armoryAtkPerLevel + buffs.atkBonus,
    def:
      party.baseDef +
      gear.def +
      camp.buildings.palisade * BUILDING_EFFECTS.palisadeDefPerLevel +
      buffs.defBonus,
  }
}

/** Steps→paces multiplier contributed by the Cartographer. */
export function campPaceMultiplier(camp: Camp): number {
  return 1 + camp.buildings.cartographer * BUILDING_EFFECTS.cartographerPaceBonusPerLevel
}

/** Salvage multiplier contributed by the Warehouse. */
export function campSalvageMultiplier(camp: Camp): number {
  return 1 + camp.buildings.warehouse * BUILDING_EFFECTS.warehouseSalvageBonusPerLevel
}

/**
 * A single number for "how strong is this party", used to pick which gear the
 * auto-equip logic prefers. Attack is weighted highest because fights are
 * resolved by attrition — killing faster is the best defence.
 */
export function powerScore(atk: number, def: number, hp: number): number {
  return atk * 3 + def * 2.2 + hp * 0.35
}
