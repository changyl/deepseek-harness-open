/**
 * Failure identity of the project domain. Every rejection a caller can act on
 * carries one stable code, so a tool can turn it into model-facing text and a
 * future transport can map it to its own taxonomy without parsing a message.
 *
 * @module @deepseek-ai/dsh-project/errors
 */

/** Stable machine code for one project-domain failure. */
export type ProjectErrorCode =
  /** No stored project carries the requested identity. */
  | 'project/not-found'
  /** The presented revision is older than the stored one. */
  | 'project/stale-version'
  /** The project is closed and refuses task work. */
  | 'project/closed'
  /** A referenced task does not exist in this project. */
  | 'project/unknown-task'
  /** The requested dependency change would make a task depend on itself. */
  | 'project/dependency-cycle'
  /** The input is unusable: empty title, unknown status, or a self-dependency. */
  | 'project/invalid-input'
  /** The project already holds the configured maximum number of tasks. */
  | 'project/limit-exceeded'

/** One refused project operation. */
export class ProjectError extends Error {
  /** Stable machine code for this failure. */
  readonly code: ProjectErrorCode

  /**
   * @param code - stable machine code for this failure.
   * @param message - operator-facing explanation.
   */
  constructor(code: ProjectErrorCode, message: string) {
    super(message)
    this.name = 'ProjectError'
    this.code = code
  }
}
