/** Shared data model. Pure types — no logic, no imports from outside `game/`. */

export const SAVE_VERSION = 1

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * A window of steps. `start`/`end` are epoch milliseconds. Native sources hand
 * us hourly (or finer) buckets; the manual/mock source fabricates one bucket.
 */
export interface StepBucket {
  start: number
  end: number
  steps: number
}

/**
 * One sync's worth of steps, split by how the data behaves over time.
 *
 * The distinction is load-bearing. Health Connect is a *store*: ask it about
 * yesterday and you always get the truth, including steps some other app wrote
 * into it after the fact. A pedometer delta or a typed-in number is a *one-shot
 * event*: count it twice and it is wrong forever.
 *
 * Treating the first kind like the second is what makes a forward-only sync
 * watermark silently lose data — a provider such as Health Sync writes steps
 * backdated to when you walked, long after the watermark has moved past them.
 */
export interface StepReading {
  /** Re-readable history. Safe to fetch repeatedly; day totals are the truth. */
  absolute: StepBucket[]
  /** One-shot deltas that must be credited exactly once. */
  incremental: StepBucket[]
}

/** Everything we remember about one calendar day, in the device's local time. */
export interface DayRecord {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string
  steps: number
  /** Most steps seen inside any 30-minute window that day — the bout signal. */
  bestBoutSteps: number
  /** Steps recorded before 09:00 local. */
  dawnSteps: number
  /** Steps recorded at or after 20:00 local. */
  duskSteps: number
  /** Manual "I trained today" check-in. */
  trained: boolean
}

// ---------------------------------------------------------------------------
// Buffs
// ---------------------------------------------------------------------------

export type BuffId =
  | 'forcedMarch'
  | 'wayfarer'
  | 'dawnWalk'
  | 'duskWalk'
  | 'personalBest'
  | 'ironBody'

export interface BuffDef {
  id: BuffId
  name: string
  /** Shown in the report; explains why the player earned it. */
  description: string
  icon: string
  /** Multiplies steps→paces for the day that earned it. */
  paceMultiplier: number
  atkBonus: number
  defBonus: number
  /** Multiplies salvage found on that day's travel. */
  salvageMultiplier: number
  /** Shifts loot rarity rolls upward. */
  lootLuck: number
}

/** A buff actually earned on a given day, with its numbers resolved. */
export interface AppliedBuff {
  id: BuffId
  name: string
  icon: string
  description: string
  /** Why the player got it, with their real numbers in it. */
  detail: string
  paceMultiplier: number
  atkBonus: number
  defBonus: number
  salvageMultiplier: number
  lootLuck: number
}

/** Several buffs folded together. */
export interface BuffTotals {
  paceMultiplier: number
  atkBonus: number
  defBonus: number
  salvageMultiplier: number
  lootLuck: number
}

// ---------------------------------------------------------------------------
// Party & gear
// ---------------------------------------------------------------------------

export type GearSlot = 'weapon' | 'armor' | 'trinket'
export type Rarity = 'common' | 'fine' | 'rare' | 'relic'

export interface Gear {
  id: string
  name: string
  slot: GearSlot
  rarity: Rarity
  atk: number
  def: number
  hp: number
}

export interface Party {
  hp: number
  baseMaxHp: number
  baseAtk: number
  baseDef: number
  gear: Record<GearSlot, Gear | null>
}

/** Party stats after gear and camp buildings are folded in. */
export interface DerivedStats {
  maxHp: number
  atk: number
  def: number
}

// ---------------------------------------------------------------------------
// Camp (meta-progression)
// ---------------------------------------------------------------------------

export type BuildingId =
  | 'hearth'
  | 'armory'
  | 'palisade'
  | 'cartographer'
  | 'warehouse'

export interface BuildingDef {
  id: BuildingId
  name: string
  description: string
  icon: string
  maxLevel: number
  /** Salvage cost to go from level `n` to `n+1`. */
  costAt: (level: number) => number
  /** Human-readable effect at a given level, for the camp UI. */
  effectAt: (level: number) => string
}

export interface Camp {
  salvage: number
  buildings: Record<BuildingId, number>
}

// ---------------------------------------------------------------------------
// Expedition
// ---------------------------------------------------------------------------

export type NodeKind = 'encounter' | 'cache' | 'shrine' | 'rest' | 'boss'

export interface RouteNode {
  id: string
  kind: NodeKind
  /** Distance along the route, in paces, at which this node sits. */
  atPace: number
  /** Set for `encounter` and `boss`. */
  enemyId?: string
}

export interface Biome {
  id: string
  name: string
  blurb: string
  /** Route length in paces. */
  length: number
  /** Palette for the route canvas: [sky, ground, accent]. */
  colors: [string, string, string]
  enemyIds: string[]
  bossId: string
  /** Scales enemy stats on top of expedition depth. */
  difficulty: number
}

export interface Expedition {
  id: string
  seed: number
  biomeId: string
  /** How many expeditions deep the player is. Drives difficulty scaling. */
  depth: number
  /** Progress along the route, in paces. */
  paces: number
  length: number
  route: RouteNode[]
  /** Index of the next unresolved node in `route`. */
  nextNodeIndex: number
  /** Salvage collected this run; banked to camp when the run ends. */
  salvage: number
}

export interface Enemy {
  id: string
  name: string
  icon: string
  hp: number
  atk: number
  def: number
  salvage: number
}

// ---------------------------------------------------------------------------
// Report log
// ---------------------------------------------------------------------------

export interface CombatRound {
  /** Damage the party dealt this round. */
  dealt: number
  /** Damage the party took this round. */
  taken: number
  enemyHp: number
  partyHp: number
}

export type LogEntry =
  | { t: 'day'; date: string; steps: number; paces: number; buffs: AppliedBuff[] }
  | {
      t: 'combat'
      nodeId: string
      enemyName: string
      enemyIcon: string
      isBoss: boolean
      rounds: CombatRound[]
      won: boolean
      partyHpAfter: number
      salvage: number
    }
  /** `salvage` is what a rejected item was broken down for; 0 when kept. */
  | { t: 'loot'; nodeId: string; gear: Gear; replaced: Gear | null; kept: boolean; salvage: number }
  | { t: 'cache'; nodeId: string; salvage: number }
  | { t: 'shrine'; nodeId: string; healed: number; partyHpAfter: number }
  | { t: 'rest'; nodeId: string; healed: number; partyHpAfter: number }
  | { t: 'death'; biomeName: string; depth: number; salvageBanked: number }
  | { t: 'complete'; biomeName: string; depth: number; salvageBanked: number; bonus: number }
  | { t: 'depart'; biomeName: string; depth: number; length: number }

export interface Report {
  /** Window the report covers. */
  from: number
  to: number
  totalSteps: number
  totalPaces: number
  entries: LogEntry[]
}

// ---------------------------------------------------------------------------
// Root save
// ---------------------------------------------------------------------------

export interface Stats {
  totalSteps: number
  expeditionsCompleted: number
  deaths: number
  bestDaySteps: number
  currentStreak: number
  bestStreak: number
  enemiesDefeated: number
}

export interface GameState {
  version: number
  /** Master seed; every derived stream hangs off this. */
  seed: number
  createdAt: number
  /** Steps with an `end` at or before this have already been credited. */
  lastSyncAt: number
  /** Daily step goal, used for streaks. */
  dailyGoal: number
  /**
   * Increments on every expedition start. Feeds the expedition seed so that
   * retrying a depth after dying generates a fresh route rather than replaying
   * the one that just killed you.
   */
  runCounter: number
  party: Party
  expedition: Expedition
  camp: Camp
  /** Newest last. Trimmed to a bounded window. */
  history: DayRecord[]
  stats: Stats
}
