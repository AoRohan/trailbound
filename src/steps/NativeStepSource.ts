import { registerPlugin } from '@capacitor/core'
import type { StepReading } from '../game/types'
import type { StepSource, StepSourceKind, StepSourceStatus } from './StepSource'

interface NativeStatus {
  kind: StepSourceKind
  label: string
  available: boolean
  permissionGranted: boolean
  detail: string
  healthConnectSdkStatus?: number
  hasStepCounter?: boolean
  error?: string | null
}

interface NativeFetch {
  source: string
  buckets: { start: number; end: number; steps: number }[]
  note?: string
  error?: string | null
}

interface StepsPlugin {
  status(): Promise<NativeStatus>
  requestPermission(): Promise<{ granted: boolean }>
  fetch(options: { since: number; now: number }): Promise<NativeFetch>
}

const Steps = registerPlugin<StepsPlugin>('Steps')

/**
 * How far back to re-read Health Connect on every sync.
 *
 * Long enough to cover a slow provider backdating a whole day of steps, short
 * enough that a phone left in a drawer doesn't dump a week into one report.
 * The native side caps this again at 4 days regardless.
 */
const TRAILING_WINDOW_MS = 2 * 24 * 60 * 60 * 1000

/**
 * The Android bridge: Health Connect, falling back to the hardware step counter.
 *
 * Everything here is defensive. The native side can return partial data, a
 * permission can be revoked between calls, and a health provider can be
 * mid-update — none of which should do anything worse than produce a sync with
 * no steps in it and an explanation on the diagnostics screen.
 */
export class NativeStepSource implements StepSource {
  readonly kind = 'health-connect' as const
  private lastNote: string | null = null
  private lastError: string | null = null

  async status(): Promise<StepSourceStatus> {
    try {
      const native = await Steps.status()
      const detail = [native.detail, this.lastNote].filter(Boolean).join(' · ')
      return {
        kind: native.kind ?? 'sensor',
        available: Boolean(native.available),
        permissionGranted: Boolean(native.permissionGranted),
        label: native.label ?? 'Device steps',
        detail: detail || 'ready',
        error: native.error ?? this.lastError,
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      return {
        kind: 'sensor',
        available: false,
        permissionGranted: false,
        label: 'Device steps',
        detail: 'The native step plugin did not respond',
        error: message,
      }
    }
  }

  async requestPermission(): Promise<boolean> {
    try {
      const { granted } = await Steps.requestPermission()
      return Boolean(granted)
    } catch (cause) {
      this.lastError = cause instanceof Error ? cause.message : String(cause)
      return false
    }
  }

  async fetch(since: number, now: number): Promise<StepReading> {
    const empty: StepReading = { absolute: [], incremental: [] }

    try {
      // Always re-read a trailing window rather than only what is newer than
      // the last sync.
      //
      // Providers like Health Sync copy steps out of Huawei/Samsung Health into
      // Health Connect *backdated to when they were walked*, minutes or hours
      // later. Asking only for "steps since my last sync" means those arrive
      // behind the watermark and are never seen — which is exactly how a
      // morning's 6,000 steps can show up as 131.
      const from = Math.min(since, now - TRAILING_WINDOW_MS)
      const response = await Steps.fetch({ since: from, now })

      this.lastNote = response.note ?? null
      this.lastError = response.error ?? null

      if (!Array.isArray(response.buckets)) return empty

      // Trust nothing about the shape; the sanitizer handles the values, but a
      // malformed entry would slip past it as NaN.
      const buckets = response.buckets
        .filter(
          (b) =>
            b &&
            Number.isFinite(b.start) &&
            Number.isFinite(b.end) &&
            Number.isFinite(b.steps),
        )
        .map((b) => ({ start: b.start, end: b.end, steps: b.steps }))

      // Health Connect is a store and can be re-read safely. The raw sensor
      // reports a delta since we last looked and must be counted exactly once.
      return response.source === 'health-connect'
        ? { absolute: buckets, incremental: [] }
        : { absolute: [], incremental: buckets }
    } catch (cause) {
      this.lastError = cause instanceof Error ? cause.message : String(cause)
      return empty
    }
  }
}
