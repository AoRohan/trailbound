/** Camp meta-progression: what salvage buys between expeditions. */

import { BUILDINGS, BUILDING_ORDER } from './content'
import type { BuildingId, Camp } from './types'

export function buildingLevel(camp: Camp, id: BuildingId): number {
  return camp.buildings[id] ?? 0
}

export function isMaxed(camp: Camp, id: BuildingId): boolean {
  return buildingLevel(camp, id) >= BUILDINGS[id].maxLevel
}

/** Cost of the next level, or `null` when the building is already maxed. */
export function upgradeCost(camp: Camp, id: BuildingId): number | null {
  if (isMaxed(camp, id)) return null
  return BUILDINGS[id].costAt(buildingLevel(camp, id))
}

export function canAfford(camp: Camp, id: BuildingId): boolean {
  const cost = upgradeCost(camp, id)
  return cost !== null && camp.salvage >= cost
}

/**
 * Buy one level. Returns a new camp, or the original untouched if the purchase
 * isn't legal — callers never have to pre-check to stay safe.
 */
export function upgrade(camp: Camp, id: BuildingId): Camp {
  const cost = upgradeCost(camp, id)
  if (cost === null || camp.salvage < cost) return camp

  return {
    salvage: camp.salvage - cost,
    buildings: { ...camp.buildings, [id]: buildingLevel(camp, id) + 1 },
  }
}

export function emptyCamp(): Camp {
  return {
    salvage: 0,
    buildings: {
      hearth: 0,
      armory: 0,
      palisade: 0,
      cartographer: 0,
      warehouse: 0,
    },
  }
}

/** Camp buildings in display order, with everything the UI needs. */
export function campView(camp: Camp) {
  return BUILDING_ORDER.map((id) => {
    const def = BUILDINGS[id]
    const level = buildingLevel(camp, id)
    const cost = upgradeCost(camp, id)
    return {
      def,
      level,
      cost,
      maxed: cost === null,
      affordable: cost !== null && camp.salvage >= cost,
      currentEffect: level > 0 ? def.effectAt(level) : null,
      nextEffect: cost !== null ? def.effectAt(level + 1) : null,
    }
  })
}
