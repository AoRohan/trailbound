import type { StepBucket } from '../game/types'
import type { StepSource, StepSourceStatus } from './StepSource'

/**
 * Steps the player types in.
 *
 * This is the browser's only option — a web page cannot read a pedometer while
 * the screen is off — and it stays available on the phone as a fallback and as
 * the way to test the game without walking a mile first.
 */
export class ManualStepSource implements StepSource {
  readonly kind = 'manual' as const
  private pending: StepBucket[] = []

  /**
   * Queue steps spread over the `minutes` leading up to `endingAt`.
   *
   * Spreading rather than dropping a single instant matters: bout detection and
   * the dawn/dusk split both read the shape of the day, so "8000 steps over the
   * last two hours" should behave like a walk, not like a teleport.
   */
  add(steps: number, minutes = 60, endingAt: number = Date.now()): void {
    if (!Number.isFinite(steps) || steps <= 0) return
    const span = Math.max(1, minutes) * 60_000
    this.pending.push({ start: endingAt - span, end: endingAt, steps })
  }

  async status(): Promise<StepSourceStatus> {
    return {
      kind: this.kind,
      available: true,
      permissionGranted: true,
      label: 'Manual entry',
      detail:
        this.pending.length > 0
          ? `${this.pending.length} entry queued`
          : 'Type in steps to walk the road',
      error: null,
    }
  }

  async requestPermission(): Promise<boolean> {
    return true
  }

  hasPending(): boolean {
    return this.pending.length > 0
  }

  async fetch(since: number, now: number): Promise<StepBucket[]> {
    const out: StepBucket[] = []

    for (const b of this.pending) {
      // Clamp into the uncredited window, but keep the step count whole.
      //
      // A native source re-reads history the game may already have counted, so
      // clipping it proportionally is right. A manual entry is the player
      // *declaring* new steps — none of it has ever been counted, so trimming
      // the window must not trim the number. If two entries land minutes apart
      // the second one simply reads as a denser burst, which is honest.
      const start = Math.max(b.start, since)
      const end = Math.max(Math.min(b.end, now), start + 1)
      out.push({ start, end, steps: b.steps })
    }

    this.pending = []
    return out
  }
}
