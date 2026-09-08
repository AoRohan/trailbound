import type { GameState } from '../game/types'

/**
 * Where the save lives.
 *
 * Async on purpose even though the local implementation is synchronous: when a
 * cloud adapter arrives it should be a new file implementing this interface,
 * not a refactor of every caller.
 */
export interface StorageAdapter {
  readonly name: string
  load(): Promise<GameState | null>
  save(state: GameState): Promise<void>
  clear(): Promise<void>
  /** Small side-channel for non-game bookkeeping, e.g. sensor baselines. */
  getMeta<T>(key: string): Promise<T | null>
  setMeta<T>(key: string, value: T): Promise<void>
}
