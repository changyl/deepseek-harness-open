/**
 * The preview's own state: the pages it has read, and how the reader views them.
 *
 * The `file` resource carries metadata only, so the text is this type's to fetch
 * and keep — page by page, keyed by the 1-based line each page starts at. The
 * view state (scroll offset, wrap, the navigation already answered) must outlive
 * the body: a tab switched away from unmounts its body and must come back where
 * it was rather than re-read or jump to its opening line again. Bucketed by tab
 * id because two tabs of one file scroll independently. The change layout is the
 * exception: it describes how this session reads changes, so it sits beside the
 * buckets and follows the reader into the tabs a step opens.
 *
 * A bucket lives as long as its tab record: the face's first read of a tab arms
 * one listener on the owner's `signal` that forgets the bucket when the record
 * ends, and a tab that never read has no bucket to forget.
 */
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { WorkspaceFileText } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { DocumentFileBytes } from './rpc.ts'
import type { DocumentLoadMode } from './document/registry.ts'

/**
 * One page as the store keeps it: its text and the Host's line count, which
 * tells a page past the file's last line (`lines: 0`) from a page holding one
 * empty line (`lines: 1`, `text: ''`).
 */
export interface TextPage {
  readonly text: string
  readonly lines: number
}

/** One tab's pages and view. */
export interface TextTabState {
  /** Explicit viewer choice for this tab; absence follows automatic matching. */
  rendererId?: string
  /** Current display-loading mode; absent before the first read. */
  mode?: DocumentLoadMode
  /** Full byte result used by complete-file renderers. */
  complete?: DocumentFileBytes
  /** The file version the loaded pages belong to; absent before the first page. */
  version: string | undefined
  /** Metadata version observed when this tab began its current read generation. */
  observedVersion: string | undefined
  /** Pages by the 1-based line each starts at. */
  pages: Record<number, TextPage>
  /** Whether the last loaded page reached the end of the file. */
  eof: boolean
  /** A page read is in flight. */
  loading: boolean
  /** Why the last page read failed; cleared by the next page. */
  failure: RemoteFailure | undefined
  /** Scroll offset of the body, in px. */
  scrollTop: number
  /** Whether long lines wrap instead of scrolling horizontally; on until the reader turns it off. */
  wrap: boolean
  /** The `navigation.revision` the body already answered; absent before the first. */
  revision: number | undefined
  /**
   * This tab's editing session; absent while the tab is only previewing.
   *
   * One object rather than a handful of flags, so entering and leaving edit mode
   * is a single assignment: a draft, a version, and a saving flag that outlive
   * each other would otherwise have to agree about whether the tab is editing.
   */
  edit: TextTabEdit | undefined
  /** The editor's seed read is in flight; the session exists only once it lands. */
  editLoading: boolean
}

/**
 * One tab's editing session: the draft, the text it is measured against, and
 * the version a save is guarded by.
 *
 * The draft comes from a whole-file read rather than from the loaded pages,
 * because a page is a lossy view of the file. `saved` is kept beside it instead
 * of being recomputed from the pages, so a reload that rebuilds the preview
 * cannot make an untouched draft read as dirty.
 */
export interface TextTabEdit {
  /** The editor's current text. */
  text: string
  /** The text `text` is compared against to decide whether this tab is dirty. */
  saved: string
  /** File version the draft was read from; the guard the next save sends. */
  version: string
  /** A save is in flight. */
  saving: boolean
  /** Why the draft could not be read, or why the last save failed. */
  failure: RemoteFailure | undefined
  /** The last save was refused because the file moved on; the reader chooses how to resolve it. */
  conflict: boolean
}

/** How a change is drawn when the reader has a choice: one column, or two. */
export type ChangeLayout = 'change' | 'split'

/** Every tab's state, keyed by tab id, under the session's own view preferences. */
export interface TextState {
  byTab: Record<TabId, TextTabState>
  /**
   * The comparison layout this session reads changes in. It outlives the change
   * it was chosen on: stepping to the next change — including one in another
   * file, whose tab that step opens — draws that change the same way.
   */
  changeLayout: ChangeLayout
}

/**
 * A tab's state before it reads, scrolls, toggles, or answers anything.
 * @returns the empty bucket.
 */
export function fresh(): TextTabState {
  return {
    version: undefined,
    observedVersion: undefined,
    pages: {},
    eof: false,
    loading: false,
    failure: undefined,
    scrollTop: 0,
    wrap: true,
    revision: undefined,
    edit: undefined,
    editLoading: false,
  }
}

/** The bucket for one tab, created on first write. */
function bucket(state: TextState, tabId: TabId): TextTabState {
  return state.byTab[tabId] ??= fresh()
}

/** The preview store's write set; every action names the tab it writes. */
type TextActions = {
  selected: (draft: TextState, tabId: TabId, rendererId: string | undefined) => void
  loading: (draft: TextState, tabId: TabId, mode?: DocumentLoadMode, observedVersion?: string) => void
  complete: (draft: TextState, tabId: TabId, file: DocumentFileBytes) => void
  page: (draft: TextState, tabId: TabId, page: WorkspaceFileText) => void
  failed: (draft: TextState, tabId: TabId, failure: RemoteFailure) => void
  reset: (draft: TextState, tabId: TabId) => void
  scrolled: (draft: TextState, tabId: TabId, scrollTop: number) => void
  toggledWrap: (draft: TextState, tabId: TabId) => void
  laidOut: (draft: TextState, layout: ChangeLayout) => void
  navigated: (draft: TextState, tabId: TabId, revision: number) => void
  editOpening: (draft: TextState, tabId: TabId) => void
  editOpened: (draft: TextState, tabId: TabId, text: string, version: string) => void
  editFailed: (draft: TextState, tabId: TabId, failure: RemoteFailure) => void
  drafted: (draft: TextState, tabId: TabId, text: string) => void
  saving: (draft: TextState, tabId: TabId) => void
  saved: (draft: TextState, tabId: TabId, text: string, version: string) => void
  saveFailed: (draft: TextState, tabId: TabId, failure: RemoteFailure, conflict: boolean) => void
  editClosed: (draft: TextState, tabId: TabId) => void
  forget: (draft: TextState, tabId: TabId) => void
}

/**
 * Declare the preview's store.
 *
 * Constructed once in apply and shared by the body and the tools registrations,
 * which the slot runtime allows because both are session-scoped.
 * @returns the store handle to declare on both registrations.
 */
export function createTextStore(): EngineStoreHandle<TextState, TextActions> {
  return defineStore({
    init: (): TextState => ({ byTab: {}, changeLayout: 'change' }),
    actions: {
      /** @param d - draft. @param tabId - owning tab. @param rendererId - manual choice, or automatic selection. */
      selected: (d, tabId: TabId, rendererId: string | undefined) => {
        if (rendererId === undefined) delete bucket(d, tabId).rendererId
        else bucket(d, tabId).rendererId = rendererId
      },
      /**
       * Mark a page read as in flight.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param mode - selected renderer's loading mode.
       * @param observedVersion - metadata version at read start; later pages retain the initial observation.
       */
      loading: (d, tabId: TabId, mode?: DocumentLoadMode, observedVersion?: string) => {
        const state = bucket(d, tabId)
        if (state.version === undefined && !state.loading) state.observedVersion = observedVersion
        state.loading = true
        state.failure = undefined
        if (mode !== undefined) state.mode = mode
      },
      /** @param d - draft. @param tabId - owning tab. @param file - complete byte result for this view. */
      complete: (d, tabId: TabId, file: DocumentFileBytes) => {
        const state = bucket(d, tabId)
        state.complete = file
        state.version = file.version
        state.eof = true
        state.loading = false
        state.failure = undefined
      },
      /**
       * Keep one page. A page from a newer file version invalidates the pages
       * of the older one, so the body never shows two versions at once.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param page - the page the Host returned.
       */
      page: (d, tabId: TabId, page: WorkspaceFileText) => {
        const state = bucket(d, tabId)
        if (state.version !== undefined && state.version !== page.version) state.pages = {}
        state.version = page.version
        state.pages[page.offset] = { text: page.text, lines: page.lines }
        state.eof = page.eof
        state.loading = false
        state.failure = undefined
      },
      /**
       * Record why a page read failed; the pages already held stay.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param failure - the settled Remote failure.
       */
      failed: (d, tabId: TabId, failure: RemoteFailure) => {
        const state = bucket(d, tabId)
        state.loading = false
        state.failure = failure
      },
      /**
       * Drop every page, keeping the view, for a re-read from the first line.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      reset: (d, tabId: TabId) => {
        const state = bucket(d, tabId)
        state.pages = {}
        delete state.complete
        state.eof = false
        state.version = undefined
        state.observedVersion = undefined
        state.loading = false
        state.failure = undefined
      },
      /**
       * Record where one tab's body is scrolled to.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param scrollTop - the body's scroll offset, in px.
       */
      scrolled: (d, tabId: TabId, scrollTop: number) => {
        bucket(d, tabId).scrollTop = scrollTop
      },
      /**
       * Switch one tab between wrapped and unwrapped lines.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      toggledWrap: (d, tabId: TabId) => {
        const state = bucket(d, tabId)
        state.wrap = !state.wrap
      },
      /**
       * Record how this session draws changes. The choice belongs to the
       * session rather than to a tab, so the step that opens the next change in
       * another file finds it already set.
       * @param d - draft state.
       * @param layout - the change layout the reader selected.
       */
      laidOut: (d, layout: ChangeLayout) => {
        d.changeLayout = layout
      },
      /**
       * Record that the body answered one navigation, so a remount restores the
       * reader's position instead of jumping again.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param revision - the `navigation.revision` answered.
       */
      navigated: (d, tabId: TabId, revision: number) => {
        bucket(d, tabId).revision = revision
      },
      /**
       * Start an editing session: the tab is editing from now on, even though
       * its draft is still being read.
       * @param d - draft state.
       * @param tabId - the tab being edited.
       */
      editOpening: (d, tabId: TabId) => {
        const state = bucket(d, tabId)
        state.editLoading = true
        state.edit = undefined
      },
      /**
       * Seed the session with the file's whole text.
       * @param d - draft state.
       * @param tabId - the tab being edited.
       * @param text - the file's complete text, as it will be saved back.
       * @param version - the version that text was read from.
       */
      editOpened: (d, tabId: TabId, text: string, version: string) => {
        const state = bucket(d, tabId)
        state.editLoading = false
        state.edit = { text, saved: text, version, saving: false, failure: undefined, conflict: false }
      },
      /**
       * Record a draft that could not be read. The session is not opened: a tab
       * with nothing to edit shows the failure and the preview behind it.
       * @param d - draft state.
       * @param tabId - the tab being edited.
       * @param failure - the settled Remote failure.
       */
      editFailed: (d, tabId: TabId, failure: RemoteFailure) => {
        const state = bucket(d, tabId)
        state.editLoading = false
        state.edit = undefined
        state.failure = failure
      },
      /**
       * Keep the reader's latest keystrokes.
       * @param d - draft state.
       * @param tabId - the tab being edited.
       * @param text - the editor's current text.
       */
      drafted: (d, tabId: TabId, text: string) => {
        const state = bucket(d, tabId).edit
        /* v8 ignore next -- the editor renders only inside a live session */
        if (state === undefined) return
        state.text = text
      },
      /**
       * Mark a save as in flight, clearing the previous refusal so a retry
       * starts from a clean slate.
       * @param d - draft state.
       * @param tabId - the tab being edited.
       */
      saving: (d, tabId: TabId) => {
        const state = bucket(d, tabId).edit
        /* v8 ignore next -- the save control renders only inside a live session */
        if (state === undefined) return
        state.saving = true
        state.failure = undefined
        state.conflict = false
      },
      /**
       * Accept a completed save: the written text becomes the clean baseline and
       * the new version becomes the guard for the next one. The session stays
       * open, because saving is not the same as stopping.
       * @param d - draft state.
       * @param tabId - the tab being edited.
       * @param text - the text that was written.
       * @param version - the version the Host reported after the write.
       */
      saved: (d, tabId: TabId, text: string, version: string) => {
        const state = bucket(d, tabId).edit
        /* v8 ignore next -- a settlement for a session the reader already closed writes nothing */
        if (state === undefined) return
        state.saving = false
        state.failure = undefined
        state.conflict = false
        state.saved = text
        state.version = version
      },
      /**
       * Record why a save failed. A stale refusal is flagged as a conflict, which
       * is the one failure the reader resolves rather than merely retries.
       * @param d - draft state.
       * @param tabId - the tab being edited.
       * @param failure - the settled Remote failure.
       * @param conflict - whether the Host refused the save as stale.
       */
      saveFailed: (d, tabId: TabId, failure: RemoteFailure, conflict: boolean) => {
        const state = bucket(d, tabId).edit
        /* v8 ignore next -- a settlement for a session the reader already closed writes nothing */
        if (state === undefined) return
        state.saving = false
        state.failure = failure
        state.conflict = conflict
      },
      /**
       * Drop the editing session and go back to previewing. Anything unsaved is
       * discarded, so the controls that call this are the ones that say so.
       * @param d - draft state.
       * @param tabId - the tab being edited.
       */
      editClosed: (d, tabId: TabId) => {
        const state = bucket(d, tabId)
        state.edit = undefined
        state.editLoading = false
      },
      /**
       * Drop one tab's state, for a tab record that is gone.
       * @param d - draft state.
       * @param tabId - the tab that went away.
       */
      forget: (d, tabId: TabId) => {
        const byTab: TextState['byTab'] = {}
        // Keys were written from tab ids; reading them back as ids is exact.
        for (const [id, state] of Object.entries(d.byTab) as [TabId, TextTabState][]) {
          if (id !== tabId) byTab[id] = state
        }
        d.byTab = byTab
      },
    },
  })
}

/** The store handle type both registrations declare. */
export type TextStore = ReturnType<typeof createTextStore>
