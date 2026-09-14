/**
 * The change identity the preview's review controls act on.
 *
 * It lives in its own module so the component can name the callback's argument
 * without importing the host package's wire vocabulary at runtime.
 * @module @deepseek-ai/dsh-client-ui-sidebar-documentpreview/review-target
 */

/** One applied change as this client names it. */
export interface ReviewTarget {
  /** `tool/result` sequence number that recorded the change. */
  readonly seq: number
  /** Path exactly as the recorded change named it. */
  readonly path: string
}
