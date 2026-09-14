/**
 * Durable task-report vocabulary: what one generated report recorded, and the
 * session event that carries it.
 *
 * @module @deepseek-ai/dsh-task-report/types
 */

/** One file the turn changed, summarized from the hunks its result recorded. */
export interface TaskReportChange {
  /** Path as the change recorded it: absolute, or relative to the workspace. */
  readonly path: string
  /** `create` when the recorded hunk had no previous text, `update` otherwise. */
  readonly kind: 'create' | 'update'
  /** Lines in the recorded new text. */
  readonly added: number
  /** Lines in the recorded previous text; zero for a create. */
  readonly removed: number
}

/** One verification command the turn ran and the outcome its result reported. */
export interface TaskReportVerification {
  /** The command line the tool call carried. */
  readonly command: string
  /** `passed` for exit code 0, `failed` for a non-zero exit or an error result. */
  readonly status: 'passed' | 'failed' | 'unknown'
  /** Exit code parsed from the rendered result, absent when it was not reported. */
  readonly exitCode?: number
}

/** Payload of one `task-report/generated` event. */
export interface TaskReportEventData {
  /** The closed turn this report describes. */
  readonly turn: number
  /** How the turn ended, as `turn/end` recorded it. */
  readonly reason: string
  /** Workspace-relative report path, absent when nothing was written. */
  readonly path?: string
  /** Why no report was written, absent when the write succeeded. */
  readonly error?: string
  /** The turn's opening user request, bounded; absent when the turn had none. */
  readonly request?: string
  /** The turn's closing assistant text, bounded; absent when nothing was said. */
  readonly summary?: string
  readonly changes: readonly TaskReportChange[]
  readonly verification: readonly TaskReportVerification[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One task report generated for a closed turn: the request it answered, the
     * files it changed, the verification it ran, and where the Markdown
     * artifact was written. Log-only — it never enters the model surface or
     * derived history.
     */
    'task-report/generated': TaskReportEventData
  }
}
