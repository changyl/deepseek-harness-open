/**
 * Function plugin registering the `effectiveness` projection unit: one
 * session's outcome signals — current human feedback, change-review
 * decisions, and task-report verification outcomes — served through the
 * session-projection seam so clients render them without re-deriving the log.
 * The unit is a read model over events other packages already append; it adds
 * no prompt, tool, or event of its own.
 *
 * @module @deepseek-ai/dsh-effectiveness
 */

import type { Context } from '@deepseek-ai/cordis'
import { effectivenessProjectionDefinition } from './projection.ts'

export type * from './types.ts'
export { effectivenessProjectionDefinition } from './projection.ts'

/** Cordis plugin name. */
export const name = 'effectiveness'

/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `effectiveness` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(effectivenessProjectionDefinition)
}
