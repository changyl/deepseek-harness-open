/**
 * Command-palette controller: the open/close store the overlay renders, the
 * per-open load of palette rows, local ranking over the loaded rows, and the
 * dispatch behind a pick. Rows come from `ctx.commandUi.palette` (host
 * catalog + client contributions, already gated by their own availability);
 * the controller prepends the conversation actions this surface owns — the
 * new-session flow and stopping the running turn.
 *
 * Rows are loaded once per open, so availability is read at open time and a
 * pick always addresses the session the palette was opened for. Typing only
 * re-ranks the loaded rows; it never issues another query.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { rankByName } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { CommandPaletteRow, CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CommandPaletteTranslate } from './locales.ts'

/** Section heading the palette's own actions sit under. */
const ACTIONS_SECTION = 'palette.section.actions'

/** What a pick does, and therefore which glyph the row shows. */
export type PaletteEntryKind = 'command' | 'new-session' | 'stop'

/** Fields every palette row carries: display copy plus the ranking keys. */
interface PaletteEntryBase {
  /** Stable identity: `action:<kind>` for an owned action, `command:<name>` otherwise. */
  readonly id: string
  /** Command name (the host name for a command row, a rankable phrase for an action). */
  readonly name: string
  /** Localized row title; the second search key. */
  readonly label: string
  /** Localized supporting line. */
  readonly description?: string
  /** Localized argument hint (`<preset>`), present on commands that take arguments. */
  readonly hint?: string
  /** Localized section heading the row renders under. */
  readonly section?: string
}

/** The new-session action: needs no session, so it exists in every palette. */
export interface PaletteNewSessionEntry extends PaletteEntryBase {
  readonly kind: 'new-session'
}

/** Stopping a turn: the session is the running one observed at open time. */
export interface PaletteStopEntry extends PaletteEntryBase {
  readonly kind: 'stop'
  readonly sessionId: SessionId
}

/** A command row, bound to the session whose catalog produced it. */
export interface PaletteCommandEntry extends PaletteEntryBase {
  readonly kind: 'command'
  readonly sessionId: SessionId
}

/** One palette row, discriminated by what its pick does. */
export type PaletteEntry = PaletteNewSessionEntry | PaletteStopEntry | PaletteCommandEntry

/** Palette lifecycle; `no-session` means the actions are offered without commands. */
export type PaletteStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'no-session'

/** What the overlay renders. */
export interface PaletteState {
  open: boolean
  status: PaletteStatus
  /** Raw filter text as typed; ranking trims it. */
  query: string
  /** Loaded rows, in section order before ranking. */
  entries: readonly PaletteEntry[]
  /** Highlighted row index within the currently visible rows. */
  active: number
  error: string | null
}

/** The closed palette: also the state a closed or superseded palette settles to. */
const CLOSED: PaletteState = {
  open: false, status: 'idle', query: '', entries: [], active: 0, error: null,
}

/**
 * Rank the loaded rows for one query.
 * @param entries - loaded rows in section order.
 * @param query - raw filter text.
 * @returns every row for a blank query, otherwise the name/label ranking.
 */
export function filterEntries(entries: readonly PaletteEntry[], query: string): readonly PaletteEntry[] {
  const trimmed = query.trim()
  return trimmed === '' ? entries : rankByName(entries, trimmed)
}

/** Everything the controller reads from the client application. */
export interface CommandPaletteDeps {
  /** Command surface: palette rows and bare-invocation dispatch. */
  readonly commands: CommandUiContract
  /** Session Controller: the current session and its cancel verb. */
  readonly sessions: ISessions
  /** Workspace navigation, absent when the deployment mounts no Workspace UI. */
  readonly workspace: Pick<UiWorkspace, 'startSession'> | undefined
  /** Palette copy, re-read on every open. */
  readonly t: CommandPaletteTranslate
}

/**
 * Headless command-palette controller. One instance serves the single
 * `shell.overlay` entry; the overlay reads {@link state} and calls the verbs
 * below, and the shortcut registry drives the same verbs.
 */
export class CommandPaletteController {
  /** State the overlay renders (bound as the entry's `palette` hook source). */
  readonly state: SnapshotStore<PaletteState> = createSnapshotStore<PaletteState>(CLOSED)

  /** Load generation: a superseded or closed load writes nothing. */
  private loadToken = 0

  /** Cancellation for the in-flight command query (absent when none is running). */
  private abort: AbortController | undefined

  /**
   * @param deps - command surface, session controller, workspace navigation, and copy.
   */
  constructor(private readonly deps: CommandPaletteDeps) {}

  /** Open the palette, or close it when already open (the shortcut's gesture). */
  toggle(): void {
    if (this.state.getSnapshot().open) this.close()
    else this.open()
  }

  /**
   * Open the palette for the current session and load its rows. Re-entrant:
   * a retry or a second open supersedes the in-flight load.
   */
  open(): void {
    const sessionId = this.deps.sessions.list.getSnapshot().current
    this.set({
      open: true,
      status: sessionId === undefined ? 'no-session' : 'loading',
      query: '',
      entries: this.actionEntries(sessionId),
      active: 0,
      error: null,
    })
    if (sessionId !== undefined) void this.load(sessionId)
  }

  /** Close the palette, cancel an in-flight load, and drop the loaded rows. */
  close(): void {
    this.loadToken += 1
    this.abort?.abort()
    this.abort = undefined
    this.set(CLOSED)
  }

  /**
   * Replace the filter text; the highlight returns to the first visible row.
   * @param query - raw filter text as typed.
   */
  setQuery(query: string): void {
    this.state.update((draft) => {
      draft.query = query
      draft.active = 0
    })
  }

  /**
   * Move the highlight through the visible rows, wrapping at both ends.
   * @param delta - rows to move (negative moves up).
   */
  move(delta: number): void {
    const state = this.state.getSnapshot()
    const rows = filterEntries(state.entries, state.query)
    if (rows.length === 0) return
    this.highlight((((state.active + delta) % rows.length) + rows.length) % rows.length)
  }

  /**
   * Highlight one visible row (pointer hover).
   * @param index - index within the visible rows, ignored when out of range.
   */
  highlight(index: number): void {
    const state = this.state.getSnapshot()
    if (index < 0 || index >= filterEntries(state.entries, state.query).length) return
    this.state.update((draft) => { draft.active = index })
  }

  /**
   * Run the row behind one id and close the palette.
   * @param id - {@link PaletteEntry.id} of the picked row.
   */
  run(id: string): void {
    const state = this.state.getSnapshot()
    const entry = filterEntries(state.entries, state.query).find(candidate => candidate.id === id)
    if (entry === undefined) return
    this.close()
    switch (entry.kind) {
      case 'new-session':
        this.deps.workspace?.startSession()
        return
      case 'stop':
        this.stop(entry.sessionId)
        return
      case 'command':
        this.deps.commands.run(entry.name, { sessionId: entry.sessionId })
    }
  }

  /**
   * Cancel the running turn, and hand the caret back to the composer the pick
   * took it from. A refused cancel settles into the Session's own prompt
   * error; only a transport rejection reaches the handler below.
   */
  private stop(sessionId: SessionId): void {
    const session = this.deps.sessions.binding(sessionId)?.session
    if (session === undefined) return
    this.deps.commands.focusComposer(sessionId)
    session.cancel().then(undefined, (error: unknown) => {
      console.warn('command palette: stop failed:', error)
    })
  }

  /** Load the command rows for one session into the open palette. */
  private async load(sessionId: SessionId): Promise<void> {
    const token = ++this.loadToken
    const abort = new AbortController()
    this.abort = abort
    try {
      const rows = await this.deps.commands.palette({ sessionId }, abort.signal)
      if (token !== this.loadToken) return
      const entries = rows.map(row => toEntry(row, sessionId))
      this.state.update((draft) => {
        draft.entries = [...draft.entries, ...entries]
        draft.status = 'ready'
      })
    } catch (error) {
      if (token !== this.loadToken) return
      this.state.update((draft) => {
        draft.status = 'failed'
        draft.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** The actions this surface owns, gated by the session they need. */
  private actionEntries(sessionId: SessionId | undefined): PaletteEntry[] {
    const section = this.deps.t(ACTIONS_SECTION)
    const entries: PaletteEntry[] = [{
      id: 'action:new-session',
      kind: 'new-session',
      name: 'new session',
      label: this.deps.t('palette.action.newSession'),
      description: this.deps.t('palette.action.newSession.description'),
      section,
    }]
    if (sessionId !== undefined && this.running(sessionId)) {
      entries.push({
        id: 'action:stop',
        kind: 'stop',
        sessionId,
        name: 'stop generating',
        label: this.deps.t('palette.action.stop'),
        description: this.deps.t('palette.action.stop.description'),
        section,
      })
    }
    return entries
  }

  /** Whether the session has a live turn the palette can cancel. */
  private running(sessionId: SessionId): boolean {
    return this.deps.sessions.binding(sessionId)?.session.getSnapshot().running === true
  }

  /** Publish one whole state value. */
  private set(next: PaletteState): void {
    this.state.set(next)
  }
}

/** Map one command row into its palette entry, bound to the session it was read for. */
function toEntry(row: CommandPaletteRow, sessionId: SessionId): PaletteCommandEntry {
  return {
    id: `command:${row.name}`,
    kind: 'command',
    sessionId,
    name: row.name,
    label: row.label ?? row.name,
    ...(row.description === undefined ? {} : { description: row.description }),
    ...(row.hint === undefined ? {} : { hint: row.hint }),
    ...(row.section === undefined ? {} : { section: row.section }),
  }
}
