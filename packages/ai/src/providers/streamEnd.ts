// Ends a provider stream: enforces the `GenerateInput.onStreamEnd` abort rule for every
// provider, including clients that do not honour `signal`.

import type { AIStreamEndInfo, GenerateInput } from '../types.js'

/**
 * Reports a normal end through `onStreamEnd`, unless the caller aborted `signal`: then the
 * callback is skipped and the iteration rejects with the abort reason, as an SDK that honours
 * the signal would have done.
 */
export function endStream(input: GenerateInput, info: AIStreamEndInfo): void {
  input.signal?.throwIfAborted()
  input.onStreamEnd?.(info)
}
