/**
 * The address-to-read translation: a `dsh-resource://file/session/<id>/<path>`
 * address names the session the read runs under and the workspace-relative path
 * it hands the Host; absolute paths also travel inside the Session address.
 * An address without a Session fails loud.
 */
import { describe, expect, it, vi } from 'vitest'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { createReadPage, createWriteFile, documentFileBytes, documentFileText, hostFileOf } from '../src/client/rpc.ts'
import type {
  ReadWorkspaceFilePage,
  WorkspaceFilesEditRemote,
  WorkspaceFilesReadRemote,
} from '../src/client/index.ts'
import { ADDRESS, FILE, PATH, SESSION, page } from './fixtures.client.ts'

describe('hostFileOf', () => {
  it('reads the session and the decoded relative path out of a session file address', () => {
    expect(hostFileOf(ADDRESS)).toEqual(FILE)
    expect(hostFileOf('dsh-resource://file/session/s%2F1/work/a%20b%23c.md')).toEqual({ sessionId: 's/1', path: 'work/a b#c.md' })
  })

  it.each(['/etc/hosts', 'C:/w/a b.md', '//host/share/a b.md'])('preserves the Session address\'s absolute path %s for the Host', (path) => {
    expect(hostFileOf(sessionFileAddress(SESSION, path))).toEqual({ sessionId: SESSION, path })
  })

  it('throws for an address that is not a Session file address', () => {
    for (const address of [
      'dsh-resource://file/absolute/etc/hosts', 'dsh-resource://file/absolute/C:/w/a.md',
      'dsh-resource://file/shared/team/notes.md', 'dsh-resource://file/session', 'file:///work/notes.md', 'sidebar://guide',
    ]) {
      expect(() => hostFileOf(address)).toThrow('not a session file address')
    }
  })
})

describe('createReadPage', () => {
  it('binds the paged read to the Remote with the offset as the only range', async () => {
    const read = vi.fn<WorkspaceFilesReadRemote['workspaceFiles']['read']>(() => Promise.resolve(page(4, ['d'], true)))
    const signal = new AbortController().signal
    const readPage: ReadWorkspaceFilePage = createReadPage({ workspaceFiles: { read } })
    await expect(readPage(SESSION, PATH, 4, signal)).resolves.toEqual(page(4, ['d'], true))
    expect(read).toHaveBeenCalledWith(SESSION, PATH, { offset: 4 }, signal)
  })
})

describe('documentFileBytes', () => {
  it.each(['', 'AAH/'])('decodes complete Remote bytes without changing metadata (%j)', (data) => {
    const file = { absolutePath: '/workspace/a.bin', version: 'v1', bytes: 3, offset: 0, data, eof: true }
    const result = documentFileBytes(file)
    expect(result).toEqual({ ...file, data: data === '' ? new Uint8Array() : new Uint8Array([0, 1, 255]) })
    expect(result.data.buffer).toBeInstanceOf(ArrayBuffer)
    expect(file.data).toBe(data)
  })

  it('rejects malformed wire base64', () => {
    expect(() => documentFileBytes({ absolutePath: '/workspace/a.bin', version: 'v1', offset: 0, data: '!!!', eof: true })).toThrow()
  })
})

describe('createWriteFile', () => {
  /** One bound write over a recorded Remote call. */
  function bound() {
    const write = vi.fn<WorkspaceFilesEditRemote['workspaceFiles']['write']>(
      () => Promise.resolve({ ok: true, value: { absolutePath: '/w/a.md', version: 'v2', operation: 'update', before: '' } }),
    )
    return { write, run: createWriteFile({ workspaceFiles: { write, readAll: vi.fn() } }) }
  }

  it('carries the guard version the draft was read from', async () => {
    const { write, run } = bound()
    const signal = new AbortController().signal
    await run(FILE, '# two\n', 'v1', signal)
    expect(write).toHaveBeenCalledExactlyOnceWith(SESSION, PATH, { text: '# two\n', expectedVersion: 'v1' }, signal)
  })

  it('omits the guard entirely for a forced overwrite, rather than sending an empty one', async () => {
    const { write, run } = bound()
    const signal = new AbortController().signal
    await run(FILE, '# mine\n', undefined, signal)
    expect(write).toHaveBeenCalledExactlyOnceWith(SESSION, PATH, { text: '# mine\n' }, signal)
  })
})

describe('documentFileText', () => {
  const file = (data: Uint8Array) => ({
    absolutePath: '/workspace/a.md', version: 'v1', offset: 0, eof: true,
    data: btoa(String.fromCharCode(...data)),
  })

  it('decodes UTF-8 and keeps the trailing newline a page read would drop', () => {
    expect(documentFileText(file(new TextEncoder().encode('a\nb\n')))).toBe('a\nb\n')
  })

  it('keeps a leading byte-order mark, so a save writes the file back unchanged', () => {
    const bytes = new Uint8Array([0xEF, 0xBB, 0xBF, 0x23, 0x20, 0x78])
    expect(documentFileText(file(bytes))).toBe('\uFEFF# x')
  })

  it('preserves CRLF line endings rather than normalizing the file under the editor', () => {
    expect(documentFileText(file(new TextEncoder().encode('a\r\nb\r\n')))).toBe('a\r\nb\r\n')
  })

  it('rejects malformed wire base64', () => {
    expect(() => documentFileText({
      absolutePath: '/workspace/a.md', version: 'v1', offset: 0, data: '!!!', eof: true,
    })).toThrow()
  })
})
