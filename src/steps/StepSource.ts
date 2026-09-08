import type { StepBucket } from '../game/types'

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
   * Steps in `(since, now]`, as buckets. May return overlapping or already-seen
   * data — `sanitizeBuckets` is responsible for making it safe, not the source.
   */
  fetch(since: number, now: number): Promise<StepBucket[]>
}
