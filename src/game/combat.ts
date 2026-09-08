/**
 * Combat resolution.
 *
 * Deterministic given the rng stream, and guaranteed to terminate: both sides
 * always deal at least 1 damage, so no fight can stall. The party strikes
 * first, which is a small but real thumb on the scale in the player's favour.
 */

import { TUNING } from './content'
import type { Rng } from './rng'
import type { CombatRound, Enemy } from './types'

export interface Combatant {
  hp: number
  atk: number
  def: number
}

export interface CombatResult {
  rounds: CombatRound[]
  won: boolean
  /** Party HP when the fight ended. Never below 0. */
  partyHp: number
}

/** Damage is attack minus defence, jittered ±15%, with a floor of 1. */
function strike(rng: Rng, atk: number, def: number): number {
  return Math.max(1, Math.round(atk * rng.float(0.85, 1.15) - def))
}

export function simulateCombat(rng: Rng, party: Combatant, enemy: Enemy): CombatResult {
  const rounds: CombatRound[] = []
  let partyHp = party.hp
  let enemyHp = enemy.hp

  for (let round = 0; round < TUNING.maxCombatRounds; round++) {
    const dealt = strike(rng, party.atk, enemy.def)
    enemyHp -= dealt

    let taken = 0
    if (enemyHp > 0) {
      taken = strike(rng, enemy.atk, party.def)
      partyHp -= taken
    }

    rounds.push({
      dealt,
      taken,
      enemyHp: Math.max(0, enemyHp),
      partyHp: Math.max(0, partyHp),
    })

    if (enemyHp <= 0) return { rounds, won: true, partyHp: Math.max(0, partyHp) }
    if (partyHp <= 0) return { rounds, won: false, partyHp: 0 }
  }

  // Ran out of rounds. Treat as a loss so the run cannot hang here forever.
  return { rounds, won: false, partyHp: Math.max(0, partyHp) }
}
