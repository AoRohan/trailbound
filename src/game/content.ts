/**
 * All game content as plain data. Nothing in here executes game logic — adding
 * a biome, enemy, or piece of gear should never require touching resolve.ts.
 */

import type {
  Biome,
  BuffDef,
  BuffId,
  BuildingDef,
  BuildingId,
  Enemy,
  GearSlot,
  Rarity,
} from './types'

// ---------------------------------------------------------------------------
// Tuning constants — the knobs worth turning when the game feels wrong
// ---------------------------------------------------------------------------

export const TUNING = {
  /** Starting party. */
  baseMaxHp: 60,
  baseAtk: 8,
  baseDef: 3,

  /** Steps→paces before any multipliers. 1:1 keeps the mental maths honest. */
  pacesPerStep: 1,

  /** Nodes are spaced randomly within this range, in paces. */
  nodeSpacing: [700, 1150] as [number, number],

  /** Ignore anything above this in a single day; a defence against bad data. */
  maxCreditedStepsPerDay: 60_000,

  /** Steps inside a 30-minute window that count as a real bout. */
  boutThreshold: 1200,

  /** Local hour before which steps count as "dawn". */
  dawnBefore: 9,
  /** Local hour at or after which steps count as "dusk". */
  duskFrom: 20,

  /** Days of DayRecord history we keep. Enough for streaks and a year chart. */
  historyDays: 400,

  /**
   * Safety valve so a pathological state can never spin forever. Both sides
   * always deal at least 1 damage, so real fights end far short of this;
   * reaching the cap is treated as a loss.
   */
  maxCombatRounds: 120,
  /**
   * Ceiling on nodes resolved in one sync. Generous, because a health app
   * backfilling a fortnight can legitimately cross dozens of expeditions.
   */
  maxNodesPerResolve: 2000,

  /** Bonus salvage for finishing a biome, before the warehouse multiplier. */
  completionBonus: 60,
  /** Fraction of run salvage kept when the party dies. */
  deathSalvageKept: 0.5,
} as const

// ---------------------------------------------------------------------------
// Buffs
// ---------------------------------------------------------------------------

export const BUFFS: Record<BuffId, BuffDef> = {
  forcedMarch: {
    id: 'forcedMarch',
    name: 'Forced March',
    description: 'A sustained burst of real walking — not shuffling around the house.',
    icon: '🥾',
    paceMultiplier: 1.15,
    atkBonus: 3,
    defBonus: 0,
    salvageMultiplier: 1,
    lootLuck: 0.05,
  },
  wayfarer: {
    id: 'wayfarer',
    name: 'Wayfarer',
    description: 'Consecutive days over your goal. Scales with the streak.',
    icon: '🔥',
    paceMultiplier: 1.02, // per streak day, applied by buffs.ts
    atkBonus: 0,
    defBonus: 1,
    salvageMultiplier: 1.05,
    lootLuck: 0,
  },
  dawnWalk: {
    id: 'dawnWalk',
    name: "Dawn's Edge",
    description: 'Moving before nine in the morning.',
    icon: '🌅',
    paceMultiplier: 1.08,
    atkBonus: 1,
    defBonus: 0,
    salvageMultiplier: 1,
    lootLuck: 0.03,
  },
  duskWalk: {
    id: 'duskWalk',
    name: 'Nightfarer',
    description: 'Still walking after eight in the evening.',
    icon: '🌙',
    paceMultiplier: 1.05,
    atkBonus: 0,
    defBonus: 1,
    salvageMultiplier: 1.1,
    lootLuck: 0.03,
  },
  personalBest: {
    id: 'personalBest',
    name: 'New Record',
    description: 'Your best step day ever. The road remembers.',
    icon: '🏆',
    paceMultiplier: 1.25,
    atkBonus: 2,
    defBonus: 2,
    salvageMultiplier: 1.5,
    lootLuck: 0.2,
  },
  ironBody: {
    id: 'ironBody',
    name: 'Iron Body',
    description: 'You logged a training session.',
    icon: '💪',
    paceMultiplier: 1.1,
    atkBonus: 2,
    defBonus: 2,
    salvageMultiplier: 1.15,
    lootLuck: 0.08,
  },
}

// ---------------------------------------------------------------------------
// Camp buildings
// ---------------------------------------------------------------------------

const cost = (base: number, ramp: number) => (level: number) =>
  Math.round(base * Math.pow(ramp, level))

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  hearth: {
    id: 'hearth',
    name: 'Hearth',
    description: 'A warm fire and a full pack. Raises maximum health.',
    icon: '🔥',
    maxLevel: 10,
    costAt: cost(40, 1.55),
    effectAt: (l) => `+${l * 8} max HP`,
  },
  armory: {
    id: 'armory',
    name: 'Armory',
    description: 'Sharper steel for every expedition.',
    icon: '⚔️',
    maxLevel: 10,
    costAt: cost(55, 1.6),
    effectAt: (l) => `+${l * 2} attack`,
  },
  palisade: {
    id: 'palisade',
    name: 'Palisade',
    description: 'Drilled defence. Reduces incoming damage.',
    icon: '🛡️',
    maxLevel: 8,
    costAt: cost(60, 1.62),
    effectAt: (l) => `+${l * 2} defence`,
  },
  cartographer: {
    id: 'cartographer',
    name: 'Cartographer',
    description: 'Better routes. Every step carries you further.',
    icon: '🗺️',
    maxLevel: 10,
    costAt: cost(70, 1.65),
    effectAt: (l) => `+${l * 4}% distance per step`,
  },
  warehouse: {
    id: 'warehouse',
    name: 'Warehouse',
    description: 'Nothing goes to waste. More salvage from everything.',
    icon: '📦',
    maxLevel: 8,
    costAt: cost(65, 1.6),
    effectAt: (l) => `+${l * 6}% salvage`,
  },
}

export const BUILDING_ORDER: BuildingId[] = [
  'hearth',
  'armory',
  'palisade',
  'cartographer',
  'warehouse',
]

/** Per-level effect magnitudes, read by stats.ts. Kept next to the defs. */
export const BUILDING_EFFECTS = {
  hearthHpPerLevel: 8,
  armoryAtkPerLevel: 2,
  palisadeDefPerLevel: 2,
  cartographerPaceBonusPerLevel: 0.04,
  warehouseSalvageBonusPerLevel: 0.06,
} as const

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function enemy(
  id: string,
  name: string,
  icon: string,
  hp: number,
  atk: number,
  def: number,
  salvage: number,
): Enemy {
  return { id, name, icon, hp, atk, def, salvage }
}

export const ENEMIES: Record<string, Enemy> = Object.fromEntries(
  [
    // Verdant
    enemy('thornhound', 'Thornhound', '🐺', 22, 6, 1, 9),
    enemy('mossling', 'Mossling', '🍄', 16, 4, 3, 7),
    enemy('roadthief', 'Road Thief', '🗡️', 20, 7, 1, 12),
    enemy('hollowstag', 'Hollow Stag', '🦌', 30, 5, 2, 13),
    enemy('greenwarden', 'The Green Warden', '🌳', 70, 9, 4, 45),

    // Ashen
    enemy('cinderrat', 'Cinder Rat', '🐀', 24, 8, 2, 11),
    enemy('slagbrute', 'Slag Brute', '🪨', 42, 9, 5, 18),
    enemy('emberwisp', 'Ember Wisp', '✨', 20, 12, 0, 15),
    enemy('ashjackal', 'Ash Jackal', '🦊', 30, 10, 2, 16),
    enemy('cinderking', 'The Cinder King', '👑', 110, 14, 6, 70),

    // Frost
    enemy('rimewolf', 'Rime Wolf', '❄️', 38, 12, 3, 17),
    enemy('icewretch', 'Ice Wretch', '🧊', 46, 10, 6, 20),
    enemy('galeshade', 'Gale Shade', '🌪️', 32, 16, 2, 22),
    enemy('frostmoth', 'Frost Moth', '🦋', 28, 13, 4, 19),
    enemy('palewinter', 'Pale Winter', '🏔️', 150, 18, 8, 100),

    // Hollow
    enemy('gloomcrawler', 'Gloom Crawler', '🕷️', 52, 16, 5, 24),
    enemy('boneechoes', 'Bone Echo', '💀', 44, 19, 4, 26),
    enemy('deepmaw', 'Deep Maw', '🦈', 68, 17, 7, 30),
    enemy('lanternghast', 'Lantern Ghast', '🏮', 40, 22, 3, 28),
    enemy('hollowheart', 'The Hollow Heart', '🖤', 200, 24, 10, 140),
  ].map((e) => [e.id, e]),
)

// ---------------------------------------------------------------------------
// Biomes
// ---------------------------------------------------------------------------

export const BIOMES: Biome[] = [
  {
    id: 'verdant',
    name: 'The Verdant Mile',
    blurb: 'Overgrown road, low walls, the smell of rain on stone.',
    length: 8_000,
    colors: ['#1b3a2a', '#2f6b45', '#8fd6a0'],
    enemyIds: ['thornhound', 'mossling', 'roadthief', 'hollowstag'],
    bossId: 'greenwarden',
    difficulty: 1,
  },
  {
    id: 'ashen',
    name: 'The Ashen Reach',
    blurb: 'Grey drifts to the horizon. Nothing has grown here in years.',
    length: 12_000,
    colors: ['#3a2320', '#6b4133', '#e0915f'],
    enemyIds: ['cinderrat', 'slagbrute', 'emberwisp', 'ashjackal'],
    bossId: 'cinderking',
    difficulty: 1.25,
  },
  {
    id: 'frost',
    name: 'The Frostbound Pass',
    blurb: 'A knife-edge trail above the cloud line. The wind never stops.',
    length: 16_000,
    colors: ['#1e2c40', '#3c5a7a', '#bfe2ff'],
    enemyIds: ['rimewolf', 'icewretch', 'galeshade', 'frostmoth'],
    bossId: 'palewinter',
    difficulty: 1.55,
  },
  {
    id: 'hollow',
    name: 'The Hollow Deep',
    blurb: 'Down, and then further down. Something below is awake.',
    length: 20_000,
    colors: ['#241b33', '#463060', '#c39bff'],
    enemyIds: ['gloomcrawler', 'boneechoes', 'deepmaw', 'lanternghast'],
    bossId: 'hollowheart',
    difficulty: 1.9,
  },
]

export function biomeById(id: string): Biome {
  const found = BIOMES.find((b) => b.id === id)
  if (!found) throw new Error(`Unknown biome: ${id}`)
  return found
}

/** Biomes cycle, so depth can grow forever. */
export function biomeForDepth(depth: number): Biome {
  return BIOMES[(depth - 1) % BIOMES.length]!
}

// ---------------------------------------------------------------------------
// Gear
// ---------------------------------------------------------------------------

export const RARITIES: Record<Rarity, { label: string; color: string; mult: number }> = {
  common: { label: 'Common', color: '#9aa7b2', mult: 1 },
  fine: { label: 'Fine', color: '#63c26a', mult: 1.45 },
  rare: { label: 'Rare', color: '#5aa9ff', mult: 2.05 },
  relic: { label: 'Relic', color: '#c98bff', mult: 3.0 },
}

export const GEAR_NAMES: Record<GearSlot, string[]> = {
  weapon: [
    'Blade', 'Hatchet', 'Spear', 'Cudgel', 'Sabre', 'Pick', 'Warfork', 'Glaive',
  ],
  armor: [
    'Jerkin', 'Mail', 'Plate', 'Cloak', 'Harness', 'Brigandine', 'Carapace',
  ],
  trinket: [
    'Charm', 'Compass', 'Sigil', 'Lantern', 'Token', 'Knot', 'Astrolabe',
  ],
}

export const GEAR_PREFIXES: Record<Rarity, string[]> = {
  common: ['Rusted', 'Plain', 'Worn', 'Chipped', 'Field'],
  fine: ['Tempered', 'Keen', 'Oiled', 'Sure', 'Traveller’s'],
  rare: ['Runed', 'Stormtouched', 'Deepforged', 'Silvered', 'Warden’s'],
  relic: ['Ashbound', 'Firstlight', 'Nameless', 'Sunder', 'Endless'],
}

/** Base stat weight per slot, before rarity and depth scaling. */
export const GEAR_SLOT_WEIGHTS: Record<GearSlot, { atk: number; def: number; hp: number }> = {
  weapon: { atk: 3.0, def: 0.2, hp: 0 },
  armor: { atk: 0.2, def: 2.2, hp: 5 },
  trinket: { atk: 1.2, def: 1.0, hp: 3 },
}
