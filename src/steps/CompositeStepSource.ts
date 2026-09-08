import type { StepBucket } from '../game/types'
import { ManualStepSource } from './ManualStepSource'
import type { StepSource, StepSourceKind, StepSourceStatus } from './StepSource'

/**
 * A device source with manual entry always available behind it.
 *
 * The escape hatch matters: Health Connect can be installed but empty (nothing
 * on the phone is writing steps to it), and a phone can have no step counter at
 * all. Without this the app would be correct, honest, and completely unplayable.
 * The UI only surfaces the manual controls when the device source is not
 * actually working, so the two can't quietly double-count the same walk.
 */
export class CompositeStepSource implements StepSource {
  readonly kind: StepSourceKind
  private readonly manual = new ManualStepSource()

  constructor(private readonly device: StepSource | null) {
    this.kind = device?.kind ?? 'manual'
  }

  /** Queue steps the player typed in. */
  add(steps: number, minutes = 60): void {
    this.manual.add(steps, minutes)
  }

  async status(): Promise<StepSourceStatus> {
    if (!this.device) return this.manual.status()
    return this.device.status()
  }

  async requestPermission(): Promise<boolean> {
    if (!this.device) return true
    return this.device.requestPermission()
  }

  async fetch(since: number, now: number): Promise<StepBucket[]> {
    const fromDevice = this.device ? await this.device.fetch(since, now) : []
    const fromPlayer = await this.manual.fetch(since, now)
    return [...fromDevice, ...fromPlayer]
  }
}
