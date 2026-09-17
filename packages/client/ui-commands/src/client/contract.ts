/**
 * Frozen contract of the client command surface. Types only. The
 * CommandUiRuntime (`ctx.commandUi`) implements this face; business packages
 * consume `register` alone.
 */
import type { ComponentType } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/** Copy for an option that must be acknowledged before onSelect can run. */
export interface SelectConfirmation {
  readonly title: string
  readonly description: string
  readonly acknowledgeLabel: string
  readonly cancelLabel: string
  readonly confirmLabel: string
}

/** One option row of a popupSelect shell. */
export interface SelectOption {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly active?: boolean
  /** Optional in-page risk gate owned by the shared popup shell. */
  readonly confirmation?: SelectConfirmation
}

/**
 * Business registration for the popupSelect command kind. Data is
 * self-served: options/onSelect use the business package's own protocol.
 * The shell component is owned by ui-commands; business never sees it. Both
 * callbacks receive the ClientSessionContext captured at popup open.
 */
export interface PopupSelectSpec {
  readonly kind: 'popupSelect'
  options(session: ClientSessionContext, signal: AbortSignal): Promise<readonly SelectOption[]>
  onSelect(option: SelectOption, session: ClientSessionContext): void | Promise<void>
}

/**
 * Business registration for the action command kind: a bare invocation
 * consumes the trigger token and runs one client-side callback. It submits nothing, so an
 * attachment-carrying draft never refuses it.
 */
export interface ActionSpec {
  readonly kind: 'action'
  /**
   * Run the action for one session.
   * @param session - the ClientSessionContext captured at invocation.
   */
  run(session: ClientSessionContext): void
}

/** The UI behavior of a contribution or decoration. */
export type CommandUiSpec = PopupSelectSpec | ActionSpec

/**
 * One client-owned command contribution: a slash-menu entry whose behavior
 * lives entirely on the client (no host descriptor). Merged with the host
 * catalog by name — a collision with a host command fails loud at candidate
 * synthesis, never shadows. Row copy is read on every candidate pass, so a
 * locale change reaches the next menu open without re-registration.
 */
export interface CommandContribution {
  /** Command name without the leading slash (unique across contributions). */
  readonly name: string
  /** Localized menu row title; the name itself when absent. */
  label?(): string
  /** Localized menu row description; the row shows none when absent. */
  description?(): string
  /** Menu row glyph from the shared icon set. */
  readonly icon?: ComponentType<IconProps>
  /** Capability filter, called with a fresh projection per candidate pass. */
  available(session: ClientSessionContext): boolean
  /** The command's UI behavior. */
  readonly ui: CommandUiSpec
}

/**
 * A UI decoration hung on one HOST command: what its BARE invocation does on
 * this client. Not a second command — the host command keeps its catalog
 * row, its argument claim (space / argued enter), and its lifecycle logging;
 * the decoration replaces only the bare menu-pick/enter with a popup whose
 * onSelect typically submits a completed line back through command.execute.
 * A decoration never manufactures a row: a name with no host catalog entry
 * in the session's directory simply never reaches the decoration.
 */
export interface CommandDecoration {
  /** The HOST command name this decorates (without the leading slash). */
  readonly name: string
  /** Capability filter, called with a fresh projection per bare invocation. */
  available(session: ClientSessionContext): boolean
  /** The bare-invocation UI. */
  readonly ui: CommandUiSpec
}

/**
 * One palette row: the localized face of a command available to one session,
 * before ranking. Icons are deliberately absent — a palette renders one glyph
 * per entry kind, while the composer menu keeps the component-per-command
 * rendering that contributions supply.
 */
export interface CommandPaletteRow {
  /** Command name without the leading slash; the row's first search key. */
  readonly name: string
  /** Localized row title; the name itself when absent. The second search key. */
  readonly label?: string
  readonly description?: string
  /** Argument hint of a command that takes arguments, e.g. `<preset>`. */
  readonly hint?: string
  /** Localized section heading the row belongs to. */
  readonly section?: string
}

/** The `ctx.commandUi` service face visible to business packages. */
export interface CommandUiContract {
  /**
   * Register one client command contribution; effect disposer. Duplicate
   * names throw at registration.
   */
  register(contribution: CommandContribution): () => void
  /**
   * Hang a bare-invocation decoration on one host command; effect disposer.
   * Duplicate names throw at registration.
   */
  decorate(decoration: CommandDecoration): () => void
  /** Resolve the per-session popup controller for one session scope (wiring/overlay layer). */
  popupFor(actx: ClientContext): unknown
  /**
   * Every command row available to one session, in section order and before
   * query filtering; the caller ranks. Rows are the ones the `/` menu shows
   * at a leading position, so a palette offers exactly the composer menu's
   * commands.
   * @param session - session projection that gates availability and resolves the catalog.
   * @param signal - cancellation for a superseded query.
   * @returns the available rows; empty for an addressed subagent session.
   */
  palette(session: ClientSessionContext, signal: AbortSignal): Promise<readonly CommandPaletteRow[]>
  /**
   * Run one command by name as a bare palette pick. No composer token exists
   * for this caller, so nothing is consumed from the draft: a client
   * contribution or decorated host command opens its popup or runs its
   * action, and every other host command runs detached as its bare line. The
   * pick hands the caret back to the composer except where it opens a popup,
   * which owns focus until it settles.
   * @param name - command name without the leading slash.
   * @param session - session projection the pick addresses.
   */
  run(name: string, session: ClientSessionContext): void
  /**
   * Return DOM focus to one session's composer, for a composer-less surface
   * whose pick left the caret nowhere. A session with no composer bound is
   * left alone.
   * @param sessionId - the session whose composer takes focus.
   */
  focusComposer(sessionId: SessionId): void
}
