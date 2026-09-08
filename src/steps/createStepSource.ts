import { ManualStepSource } from './ManualStepSource'
import type { StepSource } from './StepSource'

/**
 * Picks the best step source this device can offer.
 *
 * On the web that is always manual entry — a page cannot read a pedometer with
 * the screen off, and pretending otherwise would just produce a step counter
 * that silently loses most of the day. The native sources land with the Android
 * shell in M2 and slot in here.
 */
export function createStepSource(): StepSource {
  return new ManualStepSource()
}

export { ManualStepSource }
