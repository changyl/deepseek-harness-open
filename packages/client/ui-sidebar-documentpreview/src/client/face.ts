/**
 * The preview's asynchronous half: reading pages into the store.
 *
 * The component never awaits anything. It asks for a page and this face performs
 * the read and writes the outcome through the store's own actions — the
 * Slot-standard `inject` form, so the write set stays the store's. The session
 * the read runs under comes from the file's address, not from the slot's
 * session: the address is the read's whole authority.
 *
 * A tab's pages are one file version walked from the first line. Dropping them
 * — a reload, or a page of a newer version arriving past the first line, which
 * restarts the walk — retires every read still in flight for the tab: a
 * settlement from before the drop writes nothing. Cleanup rides the owner's
 * `signal`, armed once per tab by its first read: the abort forgets the tab's
 * bucket and this bookkeeping, a request is not made for a record that already
 * ended, and a settlement arriving after the record is gone has nothing left to
 * write to. A tab that never read has no bucket to forget.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReadDocumentBytes, ReadWorkspaceFilePage, SessionFile, WriteWorkspaceFile } from './rpc.ts'
import { documentFileBytes, documentFileText } from './rpc.ts'
import type { TextStore } from './store.ts'
import type { DocumentLoadMode } from './document/registry.ts'

/** The preview's injected business face, as the body receives it. */
export interface TextInjected {
  /**
   * Read one page into the store. A page of a newer file version than the pages
   * held, arriving past the first line, is not kept: the tab's pages are dropped
   * and the first page read again. The tab's first read arms the abort listener
   * that forgets its bucket when the record ends.
   * @param tabId - the tab being drawn.
   * @param file - the session and workspace path the tab's address names.
   * @param offset - 1-based line the page starts at.
   * @param signal - the tab record's lifetime.
   * @param observedVersion - metadata version observed at read start.
   */
  readonly loadPage: (tabId: TabId, file: SessionFile, offset: number, signal: AbortSignal, observedVersion?: string) => void
  /**
   * Drop every page and read the first one again, for a file the Host reports
   * changed. The view is kept, so the reader stays where they were; a page read
   * still in flight writes nothing when it settles.
   * @param tabId - the tab being drawn.
   * @param file - the session and workspace path the tab's address names.
   * @param signal - the tab record's lifetime.
   * @param observedVersion - metadata version observed at read start.
   */
  readonly reloadPages: (tabId: TabId, file: SessionFile, signal: AbortSignal, observedVersion?: string) => void
  /**
   * Read the complete file for a whole-file renderer.
   * @param tabId - owning tab.
   * @param file - the session and workspace path the tab's address names.
   * @param signal - tab lifetime.
   * @param observedVersion - metadata version observed at read start.
   */
  readonly loadAll: (tabId: TabId, file: SessionFile, signal: AbortSignal, observedVersion?: string) => void
  /**
   * Discard the old complete result and read again.
   * @param tabId - owning tab.
   * @param file - the session and workspace path the tab's address names.
   * @param signal - tab lifetime.
   * @param observedVersion - metadata version observed at read start.
   */
  readonly reloadAll: (tabId: TabId, file: SessionFile, signal: AbortSignal, observedVersion?: string) => void
  /**
   * Open an editing session by reading the whole file.
   *
   * The draft is read whole rather than assembled from the loaded pages: a page
   * is a lossy view, so an editor seeded from one would write back a file whose
   * line endings had quietly changed. `readAll` returns the file itself.
   * @param tabId - the tab being edited.
   * @param file - the session and workspace path the tab's address names.
   * @param signal - the tab record's lifetime.
   */
  readonly openDraft: (tabId: TabId, file: SessionFile, signal: AbortSignal) => void
  /**
   * Close the editing session, discarding an unsaved draft. A draft read still
   * in flight writes nothing when it settles.
   * @param tabId - the tab being edited.
   */
  readonly closeDraft: (tabId: TabId) => void
  /**
   * Save the draft.
   *
   * The guard is the version the draft was read from, so a file that moved on
   * since — the Agent wrote it, another tab saved it — is refused rather than
   * overwritten; the refusal is reported as a conflict for the reader to
   * resolve. Omitting the guard is the forced overwrite that resolution offers.
   * @param tabId - the tab being edited.
   * @param file - the session and workspace path the tab's address names.
   * @param text - the draft to write.
   * @param expectedVersion - the version the draft came from, or undefined to overwrite regardless.
   * @param signal - the tab record's lifetime.
   */
  readonly saveDraft: (
    tabId: TabId,
    file: SessionFile,
    text: string,
    expectedVersion: string | undefined,
    signal: AbortSignal,
  ) => void
}

/**
 * What the face remembers of one tab: the read generation a settlement must
 * match, the version of the pages held, and the token for the one draft read or
 * save a tab may have outstanding. Created by the tab's first read, which also
 * arms the one abort listener that forgets the tab.
 */
interface TabReads {
  generation: number
  version: string | undefined
  mode: DocumentLoadMode
  /** Bumped whenever a draft read starts or the session closes, retiring the one before it. */
  draft: number
}

/**
 * Bind the preview's face to one paged read, one complete-byte read, and one write.
 * @param read - the bound `workspaceFiles.read` call.
 * @param readAll - ordinary complete-byte Remote read.
 * @param write - the guarded `workspaceFiles.write` call.
 * @returns the Slot `inject` factory: bound actions in, face out. The slot's session id is unused because the address carries its own.
 */
export function textFace(
  read: ReadWorkspaceFilePage,
  readAll: ReadDocumentBytes,
  write: WriteWorkspaceFile,
): (sessionId: SessionId, actions: BoundActions<TextStore>) => TextInjected {
  return (_sessionId: SessionId, actions: BoundActions<TextStore>): TextInjected => {
    const tabs = new Map<TabId, TabReads>()
    // Reached with a live signal only: the record's end forgets the tab's
    // bucket and this bookkeeping in one listener, however often its body mounts.
    const readsOf = (tabId: TabId, signal: AbortSignal): TabReads => {
      const held = tabs.get(tabId)
      if (held !== undefined) return held
      const created: TabReads = { generation: 0, version: undefined, mode: 'text-pages', draft: 0 }
      tabs.set(tabId, created)
      signal.addEventListener('abort', () => {
        tabs.delete(tabId)
        actions.forget(tabId)
      }, { once: true })
      return created
    }
    const modeOf = (tabId: TabId, signal: AbortSignal, mode: DocumentLoadMode): TabReads => {
      const reads = readsOf(tabId, signal)
      if (reads.mode !== mode) {
        reads.mode = mode
        reads.generation++
        reads.version = undefined
        actions.reset(tabId)
      }
      return reads
    }
    const loadPage = (tabId: TabId, file: SessionFile, offset: number, signal: AbortSignal, observedVersion?: string): void => {
      if (signal.aborted) return
      const reads = modeOf(tabId, signal, 'text-pages')
      const { generation } = reads
      actions.loading(tabId, 'text-pages', observedVersion)
      void read(file.sessionId, file.path, offset, signal).then((result) => {
        if (signal.aborted || reads.generation !== generation) return
        if (!result.ok) {
          actions.failed(tabId, result.error)
          return
        }
        // Pages of two versions never meet: a newer file past the first line
        // restarts the walk from line 1, where the store adopts the new version.
        if (offset !== 1 && reads.version !== undefined && result.value.version !== reads.version) {
          restart(tabId, file, signal, observedVersion)
          return
        }
        reads.version = result.value.version
        actions.page(tabId, result.value)
      })
    }
    const loadAll = (tabId: TabId, file: SessionFile, signal: AbortSignal, observedVersion?: string): void => {
      if (signal.aborted) return
      const reads = modeOf(tabId, signal, 'bytes-complete')
      const { generation } = reads
      actions.loading(tabId, 'bytes-complete', observedVersion)
      void readAll(file, signal).then((result) => {
        if (signal.aborted || reads.generation !== generation) return
        if (!result.ok) {
          actions.failed(tabId, result.error)
          return
        }
        let file
        try {
          file = documentFileBytes(result.value)
        } catch (error) {
          actions.failed(tabId, malformedBytes(error))
          return
        }
        reads.version = file.version
        actions.complete(tabId, file)
      })
    }
    const restart = (
      tabId: TabId, file: SessionFile, signal: AbortSignal, observedVersion?: string, mode: DocumentLoadMode = 'text-pages',
    ): void => {
      if (signal.aborted) return
      const reads = readsOf(tabId, signal)
      reads.generation += 1
      reads.version = undefined
      actions.reset(tabId)
      if (mode === 'text-pages') loadPage(tabId, file, 1, signal, observedVersion)
      else loadAll(tabId, file, signal, observedVersion)
    }
    const openDraft = (tabId: TabId, file: SessionFile, signal: AbortSignal): void => {
      if (signal.aborted) return
      const reads = readsOf(tabId, signal)
      const token = ++reads.draft
      actions.editOpening(tabId)
      void readAll(file, signal).then((result) => {
        if (signal.aborted || reads.draft !== token) return
        if (!result.ok) {
          actions.editFailed(tabId, result.error)
          return
        }
        let text
        try {
          text = documentFileText(result.value)
        } catch (error) {
          actions.editFailed(tabId, malformedBytes(error))
          return
        }
        actions.editOpened(tabId, text, result.value.version)
      })
    }
    const saveDraft = (
      tabId: TabId, file: SessionFile, text: string, expectedVersion: string | undefined, signal: AbortSignal,
    ): void => {
      if (signal.aborted) return
      const reads = readsOf(tabId, signal)
      const token = ++reads.draft
      actions.saving(tabId)
      void write(file, text, expectedVersion, signal).then((result) => {
        // A session the reader closed while the save was in flight keeps its own
        // outcome: it is not editing any more, so there is nothing to report to.
        if (signal.aborted || reads.draft !== token) return
        if (!result.ok) {
          actions.saveFailed(tabId, result.error, result.error.code === 'workspace-file/stale-version')
          return
        }
        actions.saved(tabId, text, result.value.version)
        // The preview behind the editor still describes the file as it was.
        restart(tabId, file, signal, result.value.version)
      })
    }
    return {
      loadPage, reloadPages: restart, loadAll, openDraft, saveDraft,
      closeDraft: (tabId) => {
        // Retire an outstanding read or save before the session goes, so neither
        // can reopen a session the reader has already left.
        const held = tabs.get(tabId)
        /* v8 ignore next -- a session exists only after a read armed the tab */
        if (held !== undefined) held.draft += 1
        actions.editClosed(tabId)
      },
      reloadAll: (tabId, file, signal, observedVersion) => { restart(tabId, file, signal, observedVersion, 'bytes-complete') },
    }
  }
}

/**
 * The failure a whole-file read settles as when its base64 payload is malformed.
 * @param error - the decoder's own error, kept as the cause.
 * @returns a Remote-shaped refusal the failure line can render.
 */
function malformedBytes(error: unknown): RemoteFailure {
  return Object.assign(
    new Error('document file byte response has malformed base64 data', { cause: error }),
    { name: 'RemoteError', isDSHRemoteError: true as const, code: 'gateway/internal' as const, details: {} },
  )
}
