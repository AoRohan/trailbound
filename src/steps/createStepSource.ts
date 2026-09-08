import { Capacitor } from '@capacitor/core'
import { CompositeStepSource } from './CompositeStepSource'
import { ManualStepSource } from './ManualStepSource'
import { NativeStepSource } from './NativeStepSource'

/**
 * Picks the best step source this device can offer.
 *
 * On the web there is no device source at all — a page cannot read a pedometer
 * with the screen off, and pretending otherwise would produce a step counter
 * that silently loses most of the day. Inside the Android shell the native
 * plugin takes over: Health Connect where it exists, the hardware counter
 * otherwise. Manual entry sits behind both either way.
 */
export function createStepSource(): CompositeStepSource {
  const device = Capacitor.isNativePlatform() ? new NativeStepSource() : null
  return new CompositeStepSource(device)
}

export { CompositeStepSource, ManualStepSource, NativeStepSource }
