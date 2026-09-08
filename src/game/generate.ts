/** Route generation. Fully determined by (masterSeed, depth). */

import { ENEMIES, TUNING, biomeForDepth } from './content'
import { hashString, rngFor } from './rng'
import type { Enemy, Expedition, NodeKind, RouteNode } from './types'

const NODE_WEIGHTS: { item: NodeKind; weight: number }[] = [
  { item: 'encounter', weight: 55 },
  { item: 'cache', weight: 20 },
  { item: 'rest', weight: 13 },
  { item: 'shrine', weight: 12 },
]

/**
 * Stable expedition seed. Depth picks the biome and difficulty; `run` is the
 * lifetime attempt counter, so dying and retrying the same depth produces a
 * different road rather than a replay of the one that just killed you.
 */
export function expeditionSeed(masterSeed: number, depth: number, run: number): number {
  return (masterSeed ^ hashString(`expedition:${depth}:${run}`)) >>> 0
}

export function expeditionId(masterSeed: number, depth: number, run: number): string {
  return `e${depth}r${run}-${expeditionSeed(masterSeed, depth, run).toString(36)}`
}

export function generateExpedition(
  masterSeed: number,
  depth: number,
  run: number,
): Expedition {
  const biome = biomeForDepth(depth)
  const seed = expeditionSeed(masterSeed, depth, run)
  const id = expeditionId(masterSeed, depth, run)
  const rng = rngFor(seed, 'route')

  const [minGap, maxGap] = TUNING.nodeSpacing
  const route: RouteNode[] = []
  let cursor = 0
  let index = 0

  // Leave room for the boss to sit alone at the end of the road.
  const lastOrdinaryNode = biome.length - minGap

  while (true) {
    cursor += rng.int(minGap, maxGap)
    if (cursor > lastOrdinaryNode) break

    const kind = rng.weighted(NODE_WEIGHTS)
    const node: RouteNode = { id: `${id}:n${index}`, kind, atPace: cursor }
    if (kind === 'encounter') node.enemyId = rng.pick(biome.enemyIds)
    route.push(node)
    index++
  }

  route.push({
    id: `${id}:boss`,
    kind: 'boss',
    atPace: biome.length,
    enemyId: biome.bossId,
  })

  return {
    id,
    seed,
    biomeId: biome.id,
    depth,
    paces: 0,
    length: biome.length,
    route,
    nextNodeIndex: 0,
    salvage: 0,
  }
}

/**
 * Enemy stats at a given depth and biome difficulty.
 *
 * HP scales fastest, attack next, defence slowest — so deeper fights get
 * longer and more punishing without ever becoming unhittable walls.
 */
export function scaleEnemy(baseId: string, depth: number, difficulty: number): Enemy {
  const base = ENEMIES[baseId]
  if (!base) throw new Error(`Unknown enemy: ${baseId}`)

  const d = Math.max(0, depth - 1)
  return {
    ...base,
    hp: Math.round(base.hp * difficulty * (1 + 0.16 * d)),
    atk: Math.round(base.atk * Math.pow(difficulty, 0.9) * (1 + 0.12 * d)),
    def: Math.round(base.def * Math.pow(difficulty, 0.8) * (1 + 0.09 * d)),
    salvage: Math.round(base.salvage * difficulty * (1 + 0.14 * d)),
  }
}

/** Nodes not yet resolved, for the map view. */
export function remainingNodes(expedition: Expedition): RouteNode[] {
  return expedition.route.slice(expedition.nextNodeIndex)
}
