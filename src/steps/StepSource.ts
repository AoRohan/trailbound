import type { StepReading } from '../game/types'

export type StepSourceKind = 'manual' | 'health-connect' | 'sensor'

/**
 * Everything the diagnostics screen needs to explain itself.
 *
 * On-device debugging is a screenshot round-trip, so a source is required to
 * describe its own state in words rather than leaving the player (and me)
 * guessing why no steps arrived.
 */
export interface StepSourceStatus {
  kind: StepSourceKind
  /** Can this source run on this device at all? */
  available: boolean
  permissionGranted: boolean
  /** Short name for the UI, e.g. "Health Connect". */
  label: string
  /** One line of human-readable state. */
  detail: string
  /** Last failure, if any. */
  error: string | null
}

export interface StepSource {
  readonly kind: StepSourceKind
  status(): Promise<StepSourceStatus>
  /** Returns whether permission is granted after the attempt. */
  requestPermission(): Promise<boolean>
  /**
   * Steps for this sync, split into re-readable history and one-shot deltas.
   *
   * `since` is a hint, not a contract: an absolute source is free to return a
   * wider trailing window, and should, because a provider may have backdated
   * steps into the store since the last sync. Overlapping or already-seen data
   * is expected — making it safe is `resolve`'s job, not the source's.
   */
  fetch(since: number, now: number): Promise<StepReading>
}
