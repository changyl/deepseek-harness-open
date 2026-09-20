/**
 * Shared harness for the body specs: a real store instance, a real face over a
 * scripted paged read, a scripted `useResource`, and the owner props a tab
 * record carries.
 *
 * The framework's standard kit is replaced by the few members these components
 * read, behind one documented cast, so the specs exercise the components and
 * not the slot runtime.
 */
import { onTestFinished, vi } from 'vitest'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { Mock } from 'vitest'
import { act } from '@testing-library/react'
import { createElement, useSyncExternalStore } from 'react'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { ResourceSnapshot } from '@deepseek-ai/dsh-client-resources/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  WorkspaceFileBytes,
  WorkspaceFileStat,
  WorkspaceFileText,
  WorkspaceFileWriteResult,
} from '@deepseek-ai/dsh-api-workspace-files/types'
import type { DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionFileChange } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { TextPreviewProps } from '../src/client/TextPreview.tsx'
import { textFace } from '../src/client/face.ts'
import type { TextInjected } from '../src/client/face.ts'
import type { ReadDocumentBytes, ReadWorkspaceFilePage, SessionFile, WriteWorkspaceFile } from '../src/client/rpc.ts'
import { createTextStore } from '../src/client/store.ts'
import type { TextStore } from '../src/client/store.ts'
import type { DocumentPreviewProps } from '../src/client/document/contract.ts'
import { TextBody } from '../src/client/text/TextBody.tsx'
import { textBodyDefinition } from '../src/client/text/index.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SidebarRightTabActions } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

type BodySlot = PropsRenderSlots<'sidebar.right.tab.document'>['renderSlot']

/** Preserve the body-slot callback used by component fixtures. */
export function documentSlots(body: BodySlot): TextPreviewProps['renderSlot'] { return body }

export const TAB_ID = 'tab-1' as TabId
export const SESSION = 's-1' as SessionId
/** The path relative to the session's workspace root, as the Host receives it. */
export const PATH = 'work/notes.md'
export const ABSOLUTE_PATH = '/host/project/work/notes.md'
/** The tab's address: the file under this session's scope. */
export const ADDRESS = 'dsh-resource://file/session/s-1/work/notes.md'
/** What the address names, as the face receives it. */
export const FILE: SessionFile = { sessionId: SESSION, path: PATH }

/** One page the Host would return: the lines joined without a terminator, and their count. */
export function page(offset: number, lines: readonly string[], eof: boolean, version = 'v1'): RemoteResult<WorkspaceFileText> {
  return { ok: true, value: { absolutePath: ABSOLUTE_PATH, version, offset, text: lines.join('\n'), lines: lines.length, eof, bytes: 100 } }
}

/** One failed page read. */
export function failure(code: string, details: Record<string, unknown> = {}): RemoteResult<WorkspaceFileText> {
  return { ok: false, error: { code, message: 'boom', details } as unknown as RemoteFailure }
}

/** One failed whole-file read, in whichever result shape the reader expects. */
export function wholeFailure<T>(code: string, details: Record<string, unknown> = {}): RemoteResult<T> {
  return { ok: false, error: { code, message: 'boom', details } as unknown as RemoteFailure }
}

/** One whole-file read: the complete text the editor's draft is seeded from. */
export function wholeText(text: string, version = 'v1'): RemoteResult<WorkspaceFileBytes> {
  const data = new TextEncoder().encode(text)
  return {
    ok: true,
    value: {
      absolutePath: ABSOLUTE_PATH, version, offset: 0, eof: true, bytes: data.byteLength,
      data: btoa(String.fromCharCode(...data)),
    },
  }
}

/** One refused write, typed so a spec can script a mock's settled value. */
export function writeRefused(
  code: string,
  details: Record<string, unknown> = {},
): RemoteResult<WorkspaceFileWriteResult> {
  return wholeFailure<WorkspaceFileWriteResult>(code, details)
}

/** One accepted write of `text`. */
export function written(text: string, version = 'v2'): RemoteResult<WorkspaceFileWriteResult> {
  return {
    ok: true,
    value: { absolutePath: ABSOLUTE_PATH, version, bytes: text.length, operation: 'update', before: '' },
  }
}

/** The `file` resource's metadata: live, or failed beside the last live value. */
function meta(
  version: string | undefined, failure: RemoteFailure | undefined,
): ResourceSnapshot<WorkspaceFileStat> {
  const value = version === undefined ? undefined : { absolutePath: ABSOLUTE_PATH, version, bytes: 100 }
  return failure === undefined
    ? { status: version === undefined ? 'loading' : 'live', value, failure: undefined }
    : { status: 'failed', value, failure }
}

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

/** Key-echoing translate that also shows its parameters. */
export function t(key: string, params?: Record<string, unknown>): string {
  return params === undefined ? key : `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')})`
}

/** Flush page reads that resolved since the last render, then React's work. */
export async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** The owner's tab actions as recording mocks. */
interface MockedTabActions {
  readonly openResource: Mock<SidebarRightTabActions['openResource']>
  readonly openTab: Mock<SidebarRightTabActions['openTab']>
  readonly close: Mock<SidebarRightTabActions['close']>
}

/** What one tab record's harness hands a spec. Named so the helper's declaration stays portable. */
export interface Harness {
  /** The live store instance both components read. */
  instance: ReturnType<TextStore['create']>
  /** The face bound to the scripted read. */
  face: TextInjected
  /** The scripted paged read. */
  read: Mock<ReadWorkspaceFilePage>
  /** The complete byte reader, also the editor's draft read. */
  bytes: Mock<ReadDocumentBytes>
  /** The guarded whole-file write. */
  write: Mock<WriteWorkspaceFile>
  /** The tab record's lifetime. */
  controller: AbortController
  /** Current file metadata. */
  readonly file: WorkspaceFileStat | undefined
  /** The scripted `useResource`. */
  useResource: Mock<() => ResourceSnapshot<WorkspaceFileStat>>
  /** Composed props for one navigation state, in the given pane presentation. */
  props: (navigation?: { params?: unknown; revision: number }, pane?: { fullscreen?: boolean }) => TextPreviewProps
  /** Script what one offset resolves to from now on. */
  script(offset: number, result: RemoteResult<WorkspaceFileText>): void
  /** Publish another metadata version without acknowledging any tab's content. */
  setVersion(version: string | undefined): void
  /** Script the next render's `useResource` as failed with `failure`, or live again with `undefined`. */
  setFailure(failure: RemoteFailure | undefined): void
  /** Script the hunks the change index answers for one address and seq; `undefined` withdraws them. */
  setChange(address: string, seq: number, hunks: readonly DiffHunk[] | undefined): void
  /** The scripted reader-decision call the header's accept and revert controls make. */
  review: Mock<TextPreviewProps['reviewChange']>
  /** The owner's tab actions, so a spec can assert what the header opened. */
  readonly tabActions: MockedTabActions
  /** Script the decision a previous look already recorded for one change. */
  setReview(address: string, seq: number, decision: 'accepted' | 'reverted' | undefined): void
  /** Script the change next to one inside its Turn; `undefined` = the end of the Turn. */
  setNeighbour(
    address: string,
    seq: number,
    direction: 'previous' | 'next',
    change: SessionFileChange | undefined,
  ): void
  /** Script where one change sits among its Turn's changes, counted in regions. */
  setHunkRange(address: string, seq: number, range: { before: number; total: number } | undefined): void
}

/**
 * One tab record's harness.
 * @param script - the page each offset resolves to; an unscripted offset fails `not-found`.
 * @param tabId - owning tab record.
 * @param store - the session's store instance, so a spec can render a second
 * tab of the same session; defaults to a fresh one.
 * @returns the store, the scripted faces, and a props builder.
 */
export function harness(
  script: Record<number, RemoteResult<WorkspaceFileText>> = {},
  tabId = TAB_ID,
  store?: ReturnType<TextStore['create']>,
): Harness {
  const instance = store ?? createTextStore().create()
  const pages: Record<number, RemoteResult<WorkspaceFileText>> = { ...script }
  const read = vi.fn<ReadWorkspaceFilePage>((_session, _path, offset) =>
    Promise.resolve(pages[offset] ?? failure('workspace-file/not-found', { path: PATH })))
  const bytes = vi.fn<ReadDocumentBytes>(() => Promise.resolve(wholeFailure('workspace-file/not-found', { path: PATH })))
  const write = vi.fn<WriteWorkspaceFile>(() => Promise.resolve(wholeFailure('workspace-file/write-failed', { path: PATH })))
  const face = textFace(read, bytes, write)(SESSION, instance.actions)
  const current = { version: 'v1' as string | undefined, failure: undefined as RemoteFailure | undefined, snapshot: meta('v1', undefined) }
  const refresh = (): void => { current.snapshot = meta(current.version, current.failure) }
  const useResource = vi.fn<() => ResourceSnapshot<WorkspaceFileStat>>(() => current.snapshot)
  const controller = new AbortController()
  onTestFinished(() => { controller.abort() })
  const tabActions: MockedTabActions = {
    openResource: vi.fn<SidebarRightTabActions['openResource']>(),
    openTab: vi.fn<SidebarRightTabActions['openTab']>(),
    close: vi.fn<SidebarRightTabActions['close']>(),
  }
  const definitions = [textBodyDefinition(() => t('viewer.text'))]
  const review = vi.fn<TextPreviewProps['reviewChange']>(async () => undefined)
  const publish = new Map<string, readonly DiffHunk[]>()
  const reviews = new Map<string, 'accepted' | 'reverted'>()
  const neighbours = new Map<string, SessionFileChange>()
  const ranges = new Map<string, { before: number; total: number }>()
  const changeKey = (address: string, seq: number): string => `${address}#${seq}`
  const renderSlot = documentSlots((_key, owner, opts) => createElement(TextBody, {
    ...owner, useTabInfo: opts.hookContext, sessionId: SESSION, useResource,
  } as unknown as DocumentPreviewProps))
  const props = (
    navigation: { params?: unknown; revision: number } = { revision: 1 },
    pane: { fullscreen?: boolean } = {},
  ) => ({
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: pane.fullscreen ?? false },
      panel: { id: 'pane-1' },
      tab: {
        id: tabId, kind: 'text', contentId: ADDRESS, title: 'notes.md', visible: true,
        navigation: { address: ADDRESS, params: navigation.params, revision: navigation.revision },
        signal: controller.signal,
        actions: tabActions,
      },
    }),
    sessionId: SESSION,
    useResource,
    useStore: hookOf(instance),
    actions: instance.actions,
    loadPage: face.loadPage,
    reloadPages: face.reloadPages,
    prepareRenderer: face.prepareRenderer, loadAll: face.loadAll,
    reloadAll: face.reloadAll,
    openDraft: face.openDraft,
    closeDraft: face.closeDraft,
    saveDraft: face.saveDraft,
    useDocumentPreviews: () => definitions,
    readFileChange: (address: string, seq: number) => publish.get(changeKey(address, seq)),
    reviewChange: review,
    readReview: (address: string, seq: number) => reviews.get(`${address}#${String(seq)}`),
    readNeighbourChange: (address: string, seq: number, direction: 'previous' | 'next') =>
      neighbours.get(`${address}#${String(seq)}#${direction}`),
    readHunkRange: (address: string, seq: number) => ranges.get(`${address}#${String(seq)}`),
    renderSlot,
    t,
  }) as unknown as TextPreviewProps
  return {
    instance,
    face,
    read,
    bytes,
    write,
    controller,
    get file() { return current.snapshot.value },
    useResource,
    props,
    script(offset, result) { pages[offset] = result },
    setVersion(version) { current.version = version; refresh() },
    setFailure(failure) { current.failure = failure; refresh() },
    review,
    tabActions,
    setReview(address, seq, decision) {
      const key = `${address}#${String(seq)}`
      if (decision === undefined) reviews.delete(key)
      else reviews.set(key, decision)
    },
    setNeighbour(address, seq, direction, change) {
      const key = `${address}#${String(seq)}#${direction}`
      if (change === undefined) neighbours.delete(key)
      else neighbours.set(key, change)
    },
    setHunkRange(address, seq, range) {
      const key = `${address}#${String(seq)}`
      if (range === undefined) ranges.delete(key)
      else ranges.set(key, range)
    },
    setChange(address, seq, hunks) {
      if (hunks === undefined) publish.delete(changeKey(address, seq))
      else publish.set(changeKey(address, seq), hunks)
    },
  }
}
