import { registerPlugin } from '@capacitor/core'
import type { StepBucket } from '../game/types'
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

  async fetch(since: number, now: number): Promise<StepBucket[]> {
    try {
      const response = await Steps.fetch({ since, now })
      this.lastNote = response.note ?? null
      this.lastError = response.error ?? null

      if (!Array.isArray(response.buckets)) return []

      // Trust nothing about the shape; the sanitizer handles the values, but a
      // malformed entry would slip past it as NaN.
      return response.buckets
        .filter(
          (b) =>
            b &&
            Number.isFinite(b.start) &&
            Number.isFinite(b.end) &&
            Number.isFinite(b.steps),
        )
        .map((b) => ({ start: b.start, end: b.end, steps: b.steps }))
    } catch (cause) {
      this.lastError = cause instanceof Error ? cause.message : String(cause)
      return []
    }
  }
}
