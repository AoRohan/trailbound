import { parseState } from '../game/save'
import type { GameState } from '../game/types'
import type { StorageAdapter } from './StorageAdapter'

const SAVE_KEY = 'trailbound.save.v1'
const META_PREFIX = 'trailbound.meta.'

/**
 * localStorage-backed save.
 *
 * Every access is wrapped: private windows, cleared site data and browsers with
 * storage disabled all throw on plain access rather than returning null, and a
 * game that crashes on start because storage is unavailable is worse than one
 * that quietly starts a new run.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'localStorage'

  async load(): Promise<GameState | null> {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return null
      return parseState(JSON.parse(raw))
    } catch {
      return null
    }
  }

  async save(state: GameState): Promise<void> {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state))
    } catch (error) {
      // Most likely a full quota. Surfaced rather than swallowed so the
      // diagnostics screen can say why progress stopped sticking.
      console.warn('Trailbound: could not write save', error)
    }
  }

  async clear(): Promise<void> {
    try {
      localStorage.removeItem(SAVE_KEY)
    } catch {
      /* nothing useful to do */
    }
  }

  async getMeta<T>(key: string): Promise<T | null> {
    try {
      const raw = localStorage.getItem(META_PREFIX + key)
      return raw === null ? null : (JSON.parse(raw) as T)
    } catch {
      return null
    }
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    try {
      localStorage.setItem(META_PREFIX + key, JSON.stringify(value))
    } catch {
      /* nothing useful to do */
    }
  }
}
