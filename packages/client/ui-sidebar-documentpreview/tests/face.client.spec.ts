/**
 * The face's contract with the store: a read in flight is visible, its outcome
 * lands as a page or a failure, a read outlived by its tab writes nothing, a
 * reload starts over from the first line and retires the reads still out, and
 * a newer file version arriving past the first line restarts the walk. The read
 * runs under the session the file names, not the one the face was injected for.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type {
  WorkspaceFileBytes,
  WorkspaceFileText,
  WorkspaceFileWriteResult,
} from '@deepseek-ai/dsh-api-workspace-files/types'
import { textFace } from '../src/client/face.ts'
import type { DocumentFileBytes, ReadDocumentBytes, ReadWorkspaceFilePage, WriteWorkspaceFile } from '../src/client/rpc.ts'
import { documentFileBytes, hostFileOf } from '../src/client/rpc.ts'
import { createTextStore } from '../src/client/store.ts'
import { ABSOLUTE_PATH, FILE, PATH, SESSION, failure, page, wholeFailure, wholeText, written } from './fixtures.client.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

const TAB_1 = 'tab-1' as TabId

/** One read awaiting the spec's answer. */
interface PendingRead {
  readonly offset: number
  readonly promise: Promise<RemoteResult<WorkspaceFileText>>
  resolve(result: RemoteResult<WorkspaceFileText>): void
}

function complete(version = 'v1', data = new Uint8Array([0, 1, 255])) {
  return {
    ok: true as const,
    value: { absolutePath: ABSOLUTE_PATH, version, offset: 0, data, eof: true, bytes: data.byteLength },
  }
}

function bytesFailure(): RemoteResult<never> {
  return {
    ok: false,
    error: {
      name: 'RemoteError',
      isDSHRemoteError: true,
      code: 'workspace-file/outside-workspace',
      message: 'The file is outside the caller workspace',
      details: { path: ABSOLUTE_PATH },
    },
  }
}

/** Deferred results keyed by page offset or complete-read sequence number. */
function readQueue<T>() {
  const pending: Array<PromiseWithResolvers<RemoteResult<T>> & { key: number }> = []
  return {
    request(key: number): Promise<RemoteResult<T>> {
      const deferred = Promise.withResolvers<RemoteResult<T>>()
      pending.push({ ...deferred, key })
      return deferred.promise
    },
    settle: async (result: RemoteResult<T>, key?: number): Promise<void> => {
      const at = key === undefined ? 0 : pending.findIndex(call => call.key === key)
      const call = pending[at]
      if (call === undefined) throw new Error('no outstanding read to settle')
      pending.splice(at, 1)
      call.resolve(result)
      // The face registered its synchronous store-writing reaction before this await.
      await call.promise
    },
    outstanding: () => pending.map(call => call.key),
    async close(): Promise<void> {
      const remaining = pending.splice(0)
      for (const call of remaining) call.resolve(bytesFailure())
      await Promise.all(remaining.map(call => call.promise))
    },
  }
}

function bench(sessionId = 'other-session' as SessionId) {
  const instance = createTextStore().create()
  const pending: PendingRead[] = []
  const read = vi.fn<ReadWorkspaceFilePage>((_session, _path, offset) => {
    const deferred = Promise.withResolvers<RemoteResult<WorkspaceFileText>>()
    pending.push({ offset, ...deferred })
    return deferred.promise
  })
  const whole = readQueue<DocumentFileBytes>()
  let sequence = 0
  const bytes = vi.fn<ReadDocumentBytes>(() => whole.request(++sequence))
  const writes = readQueue<WorkspaceFileWriteResult>()
  let writeSequence = 0
  const write = vi.fn<WriteWorkspaceFile>(() => writes.request(++writeSequence))
  const controller = new AbortController()
  onTestFinished(async () => {
    controller.abort()
    const remaining = pending.splice(0)
    for (const call of remaining) call.resolve(failure('workspace-file/outside-workspace', { path: PATH }))
    await Promise.all([...remaining.map(call => call.promise), whole.close(), writes.close()])
  })
  // The store's own `forget`, counted: the record's end must forget a tab exactly once.
  const forget = vi.fn(instance.actions.forget)
  // Injected for another session on purpose: the address's session must win.
  const face = textFace(read, bytes, write)(sessionId, { ...instance.actions, forget })
  /** Settle the oldest outstanding read, or the oldest one for `offset`. */
  const settle = async (result: RemoteResult<WorkspaceFileText>, offset?: number): Promise<void> => {
    const at = offset === undefined ? 0 : pending.findIndex(call => call.offset === offset)
    const [call] = pending.splice(at, 1)
    if (call === undefined) throw new Error('no outstanding read to settle')
    call.resolve(result)
    await call.promise
  }
  return {
    instance, read, write, face, forget, settle, bytes, controller,
    settleWrite: writes.settle,
    outstandingWrites: writes.outstanding,
    settleAll: whole.settle,
    // The whole-read contract now yields decoded bytes; the editing specs still
    // author wire results, so they settle through the production converter.
    settleAllWire: (result: RemoteResult<WorkspaceFileBytes>, key?: number) => whole.settle(
      result.ok ? { ok: true, value: documentFileBytes(result.value) } : result, key),
    outstandingAll: whole.outstanding,
    outstanding: () => pending.map(call => call.offset),
    tab: () => instance.getSnapshot().byTab[TAB_1],
  }
}

const settlements = [
  { outcome: 'success', order: 'retired-first' },
  { outcome: 'failure', order: 'retired-first' },
  { outcome: 'success', order: 'current-first' },
  { outcome: 'failure', order: 'current-first' },
] as const

describe('textFace', () => {
  it('marks the read in flight, then keeps the page', async () => {
    const { read, face, settle, tab } = bench()
    const controller = new AbortController()
    face.loadPage(TAB_1, FILE, 1, controller.signal)
    expect(read).toHaveBeenCalledWith(SESSION, PATH, 1, controller.signal)
    expect(tab()?.loading).toBe(true)
    await settle(page(1, ['a', 'b'], false))
    expect(tab()).toMatchObject({ loading: false, pages: { 1: { text: 'a\nb', lines: 2 } }, eof: false })
  })

  it('records a failed read', async () => {
    const { face, settle, tab } = bench()
    face.loadPage(TAB_1, FILE, 1, new AbortController().signal)
    await settle(failure('workspace-file/outside-workspace', { path: PATH }))
    expect(tab()?.failure?.code).toBe('workspace-file/outside-workspace')
    expect(tab()?.loading).toBe(false)
  })

  it('forgets the tab when its record ends, once, however many reads armed it, and writes nothing afterwards', async () => {
    const { read, face, forget, settle, tab } = bench()
    const controller = new AbortController()
    const armed = vi.spyOn(controller.signal, 'addEventListener')
    onTestFinished(() => { armed.mockRestore() })
    face.loadPage(TAB_1, FILE, 1, controller.signal)
    await settle(page(1, ['a'], false))
    face.loadPage(TAB_1, FILE, 2, controller.signal)
    face.reloadPages(TAB_1, FILE, controller.signal)
    expect(armed.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(1)
    expect(tab()).toBeDefined()
    controller.abort()
    expect(forget).toHaveBeenCalledExactlyOnceWith(TAB_1)
    expect(tab()).toBeUndefined()
    // The reads still out settle into nothing, and no request is made for the ended record.
    await settle(page(1, ['A'], true))
    expect(tab()).toBeUndefined()
    face.loadPage(TAB_1, FILE, 1, controller.signal)
    face.reloadPages(TAB_1, FILE, controller.signal)
    expect(read).toHaveBeenCalledTimes(3)
    expect(tab()).toBeUndefined()
  })

  it('reloads from the first line, dropping the pages and keeping the view', async () => {
    const { instance, read, face, settle, tab } = bench()
    const controller = new AbortController()
    face.loadPage(TAB_1, FILE, 1, controller.signal)
    await settle(page(1, ['a'], false))
    instance.actions.scrolled(TAB_1, 77)
    face.reloadPages(TAB_1, FILE, controller.signal)
    expect(tab()).toMatchObject({ pages: {}, eof: false, version: undefined, loading: true, scrollTop: 77 })
    expect(read).toHaveBeenLastCalledWith(SESSION, PATH, 1, controller.signal)
  })

  it('drops a page that settles after a reload retired it, whichever lands first', async () => {
    const { face, settle, outstanding, tab } = bench()
    const signal = new AbortController().signal
    face.loadPage(TAB_1, FILE, 1, signal)
    await settle(page(1, ['a', 'b', 'c'], false))
    // Load-more is out when the reader reloads: the new first page lands first.
    face.loadPage(TAB_1, FILE, 4, signal)
    face.reloadPages(TAB_1, FILE, signal)
    expect(outstanding()).toEqual([4, 1])
    await settle(page(1, ['A'], false, 'v2'), 1)
    expect(tab()).toMatchObject({ pages: { 1: { text: 'A', lines: 1 } }, version: 'v2', eof: false, loading: false })
    // The retired page lands afterwards and changes nothing, not even the end flag.
    await settle(page(4, ['d'], true), 4)
    expect(tab()).toMatchObject({ pages: { 1: { text: 'A', lines: 1 } }, version: 'v2', eof: false, loading: false })
  })

  it('starts the walk over when a page of a newer version arrives past the first line', async () => {
    const { read, face, settle, outstanding, tab } = bench()
    const signal = new AbortController().signal
    face.loadPage(TAB_1, FILE, 1, signal)
    await settle(page(1, ['a', 'b', 'c'], false))
    face.loadPage(TAB_1, FILE, 4, signal)
    // The file changed between the two reads: the page is not kept beside the older ones.
    await settle(page(4, ['D'], true, 'v2'))
    expect(tab()).toMatchObject({ pages: {}, version: undefined, eof: false, loading: true })
    expect(read).toHaveBeenCalledTimes(3)
    expect(outstanding()).toEqual([1])
    await settle(page(1, ['A', 'B'], true, 'v2'))
    expect(tab()).toMatchObject({ pages: { 1: { text: 'A\nB', lines: 2 } }, version: 'v2', eof: true, loading: false })
  })

  it('keeps a first page of a newer version, since the store drops the older pages for it', async () => {
    const { face, settle, tab } = bench()
    const signal = new AbortController().signal
    face.loadPage(TAB_1, FILE, 1, signal)
    await settle(page(1, ['a'], false))
    // A retry of the first page after the file changed lands as the new version.
    face.loadPage(TAB_1, FILE, 1, signal)
    await settle(page(1, ['A'], true, 'v2'))
    expect(tab()).toMatchObject({ pages: { 1: { text: 'A', lines: 1 } }, version: 'v2', eof: true })
  })
  it('loads native complete bytes with cancellable read lifetime', async () => {
    const { face, read, bytes, settleAll, tab, controller } = bench()
    const result = complete()
    face.loadAll(TAB_1, FILE, controller.signal)
    expect(bytes).toHaveBeenCalledExactlyOnceWith(FILE, expect.any(AbortSignal))
    expect(read).not.toHaveBeenCalled()
    expect(tab()).toMatchObject({ mode: 'bytes-complete', loading: true, pages: {}, failure: undefined })
    expect(tab()?.complete).toBeUndefined()
    await settleAll(result)
    expect(tab()).toMatchObject({ mode: 'bytes-complete', loading: false, complete: result.value, version: 'v1', eof: true, pages: {} })
  })

  it('records a complete-read failure and clears it when the read is retried', async () => {
    const { face, settleAll, tab, controller } = bench()
    face.loadAll(TAB_1, FILE, controller.signal)
    await settleAll(bytesFailure())
    expect(tab()).toMatchObject({ mode: 'bytes-complete', loading: false, failure: { code: 'workspace-file/outside-workspace' } })
    expect(tab()?.complete).toBeUndefined()
    face.loadAll(TAB_1, FILE, controller.signal)
    expect(tab()).toMatchObject({ loading: true, failure: undefined })
    await settleAll(complete())
    expect(tab()).toMatchObject({ loading: false, failure: undefined, complete: complete().value })
  })

  it('reloads complete bytes, discarding the old result and preserving the view', async () => {
    const { instance, face, bytes, settleAll, tab, controller } = bench()
    face.loadAll(TAB_1, FILE, controller.signal)
    await settleAll(complete())
    instance.actions.selected(TAB_1, 'test/whole-file')
    instance.actions.scrolled(TAB_1, 77)
    instance.actions.toggledWrap(TAB_1)
    instance.actions.navigated(TAB_1, 3)
    face.reloadAll(TAB_1, FILE, controller.signal)
    expect(bytes).toHaveBeenCalledTimes(2)
    expect(bytes).toHaveBeenLastCalledWith(FILE, expect.any(AbortSignal))
    expect(tab()).toMatchObject({ mode: 'bytes-complete', loading: true, version: undefined, eof: false, pages: {} })
    expect(tab()?.complete).toBeUndefined()
    const result = complete('v2', new Uint8Array([2, 3, 255]))
    await settleAll(result)
    expect(tab()).toMatchObject({
      complete: result.value, version: 'v2', loading: false, eof: true,
      rendererId: 'test/whole-file', scrollTop: 77, wrap: false, revision: 3,
    })
  })

  it('reports a failed complete reload without restoring the discarded bytes', async () => {
    const { face, settleAll, tab, controller } = bench()
    face.loadAll(TAB_1, FILE, controller.signal)
    await settleAll(complete())
    face.reloadAll(TAB_1, FILE, controller.signal)
    await settleAll(bytesFailure())
    expect(tab()).toMatchObject({
      mode: 'bytes-complete', loading: false, version: undefined, eof: false,
      failure: { code: 'workspace-file/outside-workspace' },
    })
    expect(tab()?.complete).toBeUndefined()
  })

  it.each(['loadAll', 'reloadAll'] as const)('%s does not request or create state for an ended tab', (method) => {
    const { face, bytes, forget, tab, controller } = bench()
    controller.abort()
    face[method](TAB_1, FILE, controller.signal)
    expect(bytes).not.toHaveBeenCalled()
    expect(forget).not.toHaveBeenCalled()
    expect(tab()).toBeUndefined()
  })

  it.each(['success', 'failure'] as const)('ignores complete-read %s after tab abort', async (outcome) => {
    const { instance, face, bytes, forget, settleAll, tab, controller } = bench()
    face.loadAll(TAB_1, FILE, controller.signal)
    face.reloadAll(TAB_1, FILE, controller.signal)
    controller.abort()
    expect(forget).toHaveBeenCalledExactlyOnceWith(TAB_1)
    expect(tab()).toBeUndefined()
    const snapshot = instance.getSnapshot()
    await settleAll(outcome === 'success' ? complete() : bytesFailure(), 1)
    await settleAll(outcome === 'success' ? complete('v2') : bytesFailure(), 2)
    expect(instance.getSnapshot()).toBe(snapshot)
    face.loadAll(TAB_1, FILE, controller.signal)
    face.reloadAll(TAB_1, FILE, controller.signal)
    expect(bytes).toHaveBeenCalledTimes(2)
    expect(instance.getSnapshot()).toBe(snapshot)
  })

  it.each(settlements)('ignores retired complete-read $outcome after reload ($order)', async ({ outcome, order }) => {
    const { instance, face, settleAll, outstandingAll, tab, controller } = bench()
    face.loadAll(TAB_1, FILE, controller.signal)
    face.reloadAll(TAB_1, FILE, controller.signal)
    expect(outstandingAll()).toEqual([1, 2])
    const current = complete('v2', new Uint8Array([2, 3, 255]))
    const settleRetired = async (): Promise<void> => {
      const snapshot = instance.getSnapshot()
      await settleAll(outcome === 'success' ? complete() : bytesFailure(), 1)
      expect(instance.getSnapshot()).toBe(snapshot)
    }
    if (order === 'retired-first') {
      await settleRetired()
      await settleAll(current, 2)
    } else {
      await settleAll(current, 2)
      await settleRetired()
    }
    expect(tab()).toMatchObject({ complete: current.value, version: 'v2', loading: false, failure: undefined })
  })

  describe.each(['text-pages', 'bytes-complete'] as const)('switching away from %s', (mode) => {
    it.each(settlements)('ignores the previous mode\'s $outcome ($order)', async ({ outcome, order }) => {
      const { instance, face, settle, settleAll, outstanding, outstandingAll, tab, controller } = bench()
      const { signal } = controller
      if (mode === 'text-pages') {
        face.loadPage(TAB_1, FILE, 1, signal)
        face.loadAll(TAB_1, FILE, signal)
      } else {
        face.loadAll(TAB_1, FILE, signal)
        face.loadPage(TAB_1, FILE, 1, signal)
      }
      expect(outstanding()).toEqual([1])
      expect(outstandingAll()).toEqual([1])
      const settleRetired = async (): Promise<void> => {
        const snapshot = instance.getSnapshot()
        if (mode === 'text-pages') await settle(outcome === 'success' ? page(1, ['old'], true) : bytesFailure())
        else await settleAll(outcome === 'success' ? complete() : bytesFailure())
        expect(instance.getSnapshot()).toBe(snapshot)
      }
      const settleCurrent = async (): Promise<void> => {
        if (mode === 'text-pages') await settleAll(complete('v2', new Uint8Array([2, 3, 255])))
        else await settle(page(1, ['current'], true, 'v2'))
      }
      if (order === 'retired-first') {
        await settleRetired()
        await settleCurrent()
      } else {
        await settleCurrent()
        await settleRetired()
      }
      expect(tab()).toMatchObject({ version: 'v2', loading: false, failure: undefined, eof: true })
      if (mode === 'text-pages') {
        expect(tab()).toMatchObject({ mode: 'bytes-complete', pages: {}, complete: complete('v2', new Uint8Array([2, 3, 255])).value })
      } else {
        expect(tab()).toMatchObject({ mode: 'text-pages', pages: { 1: { text: 'current', lines: 1 } } })
        expect(tab()?.complete).toBeUndefined()
      }
    })
  })

  it('keeps earlier generations retired after returning to complete-byte mode', async () => {
    const { instance, face, settle, settleAll, tab, controller } = bench()
    face.loadAll(TAB_1, FILE, controller.signal)
    face.loadPage(TAB_1, FILE, 1, controller.signal)
    face.loadAll(TAB_1, FILE, controller.signal)
    await settleAll(complete('v2', new Uint8Array([2, 3, 255])), 2)
    const snapshot = instance.getSnapshot()
    await settleAll(complete(), 1)
    await settle(bytesFailure())
    expect(instance.getSnapshot()).toBe(snapshot)
    expect(tab()).toMatchObject({ mode: 'bytes-complete', complete: complete('v2', new Uint8Array([2, 3, 255])).value, pages: {} })
  })


  it.each([PATH, ABSOLUTE_PATH, 'C:/w/notes.md', '//host/share/notes.md'])('uses the addressed Session for %s in both reading modes', async (path) => {
    const first = bench()
    const secondSession = 'second-caller-session' as SessionId
    const second = bench(secondSession)
    const address = sessionFileAddress(SESSION, path)
    const firstFile = hostFileOf(address)
    const secondFile = hostFileOf(address)
    expect(firstFile).toEqual({ sessionId: SESSION, path })
    expect(secondFile).toEqual(firstFile)
    first.face.loadPage(TAB_1, firstFile, 1, first.controller.signal)
    second.face.reloadPages(TAB_1, secondFile, second.controller.signal)
    expect(first.read).toHaveBeenCalledExactlyOnceWith(firstFile.sessionId, firstFile.path, 1, first.controller.signal)
    expect(second.read).toHaveBeenCalledExactlyOnceWith(secondFile.sessionId, secondFile.path, 1, second.controller.signal)
    await first.settle(page(1, ['first'], true))
    await second.settle(page(1, ['second'], true))
    first.face.loadAll(TAB_1, firstFile, first.controller.signal)
    second.face.reloadAll(TAB_1, secondFile, second.controller.signal)
    expect(first.bytes).toHaveBeenCalledExactlyOnceWith(firstFile, expect.any(AbortSignal))
    expect(second.bytes).toHaveBeenCalledExactlyOnceWith(secondFile, expect.any(AbortSignal))
    await first.settleAll(complete('v1'))
    await second.settleAll(complete('v2'))
    expect(first.tab()?.version).toBe('v1')
    expect(second.tab()?.version).toBe('v2')
  })
})


describe('textFace — editing', () => {
  it('seeds the draft from a whole-file read, never from the pages on screen', async () => {
    const b = bench()
    b.face.openDraft(TAB_1, FILE, b.controller.signal)
    expect(b.tab()).toMatchObject({ editLoading: true, edit: undefined })
    expect(b.read).not.toHaveBeenCalled()
    await b.settleAllWire(wholeText('# one\n', 'v7'))
    expect(b.tab()?.edit).toEqual({
      text: '# one\n', saved: '# one\n', version: 'v7', saving: false, failure: undefined, conflict: false,
    })
    expect(b.bytes).toHaveBeenCalledExactlyOnceWith(FILE, b.controller.signal)
  })

  it('reports a draft the Host refused, and opens no session over it', async () => {
    const b = bench()
    b.face.openDraft(TAB_1, FILE, b.controller.signal)
    await b.settleAllWire(wholeFailure('workspace-file/too-large', { path: PATH, limit: 10 }))
    expect(b.tab()).toMatchObject({ editLoading: false, edit: undefined })
    expect(b.tab()?.failure).toMatchObject({ code: 'workspace-file/too-large' })
  })

  it('retires a draft read that settles after the reader left, so it cannot reopen the session', async () => {
    const b = bench()
    b.face.openDraft(TAB_1, FILE, b.controller.signal)
    b.face.closeDraft(TAB_1)
    expect(b.tab()).toMatchObject({ editLoading: false, edit: undefined })
    await b.settleAllWire(wholeText('late\n'))
    expect(b.tab()?.edit).toBeUndefined()
  })

  it('sends the draft with the version it was read from, then makes that write the clean baseline', async () => {
    const b = bench()
    b.face.openDraft(TAB_1, FILE, b.controller.signal)
    await b.settleAllWire(wholeText('one\n', 'v1'))
    b.instance.actions.drafted(TAB_1, 'two\n')
    b.face.saveDraft(TAB_1, FILE, 'two\n', 'v1', b.controller.signal)
    expect(b.tab()?.edit?.saving).toBe(true)
    expect(b.write).toHaveBeenCalledExactlyOnceWith(FILE, 'two\n', 'v1', b.controller.signal)
    await b.settleWrite(written('two\n', 'v2'))
    expect(b.tab()?.edit).toMatchObject({
      text: 'two\n', saved: 'two\n', version: 'v2', saving: false, failure: undefined, conflict: false,
    })
    // The pages behind the editor still describe the file before the write.
    expect(b.read).toHaveBeenCalledWith(FILE.sessionId, FILE.path, 1, b.controller.signal)
  })

  it('keeps the keystrokes typed while the save was in flight, so the tab is dirty again', async () => {
    const b = bench()
    b.face.openDraft(TAB_1, FILE, b.controller.signal)
    await b.settleAllWire(wholeText('one\n', 'v1'))
    b.face.saveDraft(TAB_1, FILE, 'two\n', 'v1', b.controller.signal)
    // The settlement must not write the draft back: it describes an older moment.
    b.instance.actions.drafted(TAB_1, 'two\nthree\n')
    await b.settleWrite(written('two\n', 'v2'))
    expect(b.tab()?.edit).toMatchObject({ text: 'two\nthree\n', saved: 'two\n', version: 'v2', saving: false })
  })

  it('travels without a guard when the reader chooses to overwrite', async () => {
    const b = bench()
    b.face.openDraft(TAB_1, FILE, b.controller.signal)
    await b.settleAllWire(wholeText('one\n', 'v1'))
    b.face.saveDraft(TAB_1, FILE, 'mine\n', undefined, b.controller.signal)
    expect(b.write).toHaveBeenCalledExactlyOnceWith(FILE, 'mine\n', undefined, b.controller.signal)
  })

  it('flags a stale refusal as a conflict and leaves the preview alone', async () => {
    const b = bench()
    b.face.openDraft(TAB_1, FILE, b.controller.signal)
    await b.settleAllWire(wholeText('one\n', 'v1'))
    b.face.saveDraft(TAB_1, FILE, 'two\n', 'v1', b.controller.signal)
    await b.settleWrite(wholeFailure('workspace-file/stale-version', { path: PATH, expectedVersion: 'v1' }))
    expect(b.tab()?.edit).toMatchObject({ saving: false, conflict: true, saved: 'one\n' })
    expect(b.tab()?.edit?.failure).toMatchObject({ code: 'workspace-file/stale-version' })
    expect(b.read).not.toHaveBeenCalled()
  })

  it('reports every other refusal as a plain failure, with no conflict to resolve', async () => {
    const b = bench()
    b.face.openDraft(TAB_1, FILE, b.controller.signal)
    await b.settleAllWire(wholeText('one\n', 'v1'))
    b.face.saveDraft(TAB_1, FILE, 'two\n', 'v1', b.controller.signal)
    await b.settleWrite(wholeFailure('workspace-file/read-only', { path: PATH, mode: 'read-only' }))
    expect(b.tab()?.edit).toMatchObject({ saving: false, conflict: false })
    expect(b.tab()?.edit?.failure).toMatchObject({ code: 'workspace-file/read-only' })
  })

  it('writes nothing when a save settles after the reader left the editor', async () => {
    const b = bench()
    b.face.openDraft(TAB_1, FILE, b.controller.signal)
    await b.settleAllWire(wholeText('one\n', 'v1'))
    b.face.saveDraft(TAB_1, FILE, 'two\n', 'v1', b.controller.signal)
    b.face.closeDraft(TAB_1)
    await b.settleWrite(written('two\n', 'v2'))
    expect(b.tab()?.edit).toBeUndefined()
    expect(b.read).not.toHaveBeenCalled()
  })

  it('re-reads the draft whole when a conflict is resolved by reloading', async () => {
    const b = bench()
    b.face.openDraft(TAB_1, FILE, b.controller.signal)
    await b.settleAllWire(wholeText('one\n', 'v1'))
    // The reader's second read sees what the other writer left behind.
    b.face.openDraft(TAB_1, FILE, b.controller.signal)
    await b.settleAllWire(wholeText('theirs\n', 'v9'))
    expect(b.tab()?.edit).toMatchObject({ text: 'theirs\n', saved: 'theirs\n', version: 'v9', conflict: false })
  })
})

it.each([new Error('invalid bytes'), 'invalid bytes'])('reports an active complete-read decoding failure: %s', async (failure) => {
  const instance = createTextStore().create()
  const controller = new AbortController()
  const read = vi.fn<ReadDocumentBytes>().mockRejectedValue(failure)
  try {
    textFace(vi.fn(), read)(SESSION, instance.actions).loadAll(TAB_1, FILE, controller.signal)
    await Promise.resolve()
    expect(instance.getSnapshot().byTab[TAB_1]?.failure).toMatchObject({ code: 'gateway/internal', message: 'invalid bytes' })
  } finally { controller.abort() }
})

it('ignores a complete-read rejection after renderer-owned loading takes over', async () => {
  const instance = createTextStore().create()
  const controller = new AbortController()
  const pending = Promise.withResolvers<Awaited<ReturnType<ReadDocumentBytes>>>()
  const face = textFace(vi.fn(), () => pending.promise)(SESSION, instance.actions)
  try {
    face.loadAll(TAB_1, FILE, controller.signal)
    face.prepareRenderer(TAB_1, controller.signal, 'office')
    pending.reject(new Error('retired'))
    await pending.promise.catch(() => {})
    expect(instance.getSnapshot().byTab[TAB_1]?.failure).toBeUndefined()
  } finally { controller.abort() }
})
