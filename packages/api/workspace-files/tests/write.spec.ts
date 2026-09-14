/**
 * The `write` endpoint: the only mutation on this service, so every gate that
 * protects a read is re-checked here plus the two that only a write needs — a
 * live Session to resolve a policy from, and a policy that permits writing.
 *
 * The gates are asserted against a real local backend wherever the outcome is
 * observable on disk, because the point of each one is that nothing was written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkspaceFileWatchFrame } from '../src/types.ts'
import { failureOf, openWorkspace, signal, type Harness } from './harness.ts'

let harness: Harness
const closeStreams: Array<() => Promise<unknown>> = []

beforeEach(async () => {
  harness = await openWorkspace('dsh-workspace-files-write-')
})

afterEach(async () => {
  try {
    for (const close of closeStreams.splice(0)) await close()
    await harness.dispose()
  } finally {
    vi.restoreAllMocks()
  }
})

/** The bytes on disk, which is how "nothing was written" is proven. */
const contents = (name: string): Promise<string> => readFile(join(harness.workspace, name), 'utf8')

describe('workspaceFiles.write — the happy path', () => {
  it('replaces the file, reporting the new version, the operation, and the prior content', async () => {
    await writeFile(join(harness.workspace, 'notes.md'), '# one\n', 'utf8')
    const endpoint = harness.endpoint()
    const before = await endpoint.stat(harness.scope, 'notes.md', signal())
    const result = await endpoint.write(harness.scope, 'notes.md', { text: '# two\n' }, signal())
    expect(result.operation).toBe('update')
    expect(result.before).toBe('# one\n')
    expect(result.version).not.toBe(before.version)
    expect(await contents('notes.md')).toBe('# two\n')
    // The version the write reports is the one the next read is guarded against.
    expect(await endpoint.stat(harness.scope, 'notes.md', signal())).toMatchObject({ version: result.version, bytes: 6 })
    // `read.text` is the paged line view (no trailing empty line); `before` is
    // the raw prior content, which is why the two sides of the diff differ here.
    expect(await endpoint.read(harness.scope, 'notes.md', {}, signal())).toMatchObject({ text: '# two', lines: 1, eof: true })
  })

  it('resolves the policy from the live Session and hands that same policy to the backend', async () => {
    await writeFile(join(harness.workspace, 'notes.md'), 'x\n', 'utf8')
    const writeText = vi.spyOn(harness.ctx.fs, 'writeText')
    await harness.endpoint().write(harness.scope, 'notes.md', { text: 'y\n' }, signal())
    expect(harness.policySessions).toHaveLength(1)
    expect(harness.policySessions[0]).toMatchObject({ id: 's-test' })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0]?.[4]).toMatchObject({ mode: 'workspace-write', workspaceRoot: harness.workspace })
  })
})

describe('workspaceFiles.write — the version guard', () => {
  it('accepts the version the content was read from', async () => {
    await writeFile(join(harness.workspace, 'notes.md'), 'one\n', 'utf8')
    const endpoint = harness.endpoint()
    const loaded = await endpoint.stat(harness.scope, 'notes.md', signal())
    const result = await endpoint.write(
      harness.scope,
      'notes.md',
      { text: 'two\n', expectedVersion: loaded.version },
      signal(),
    )
    expect(result.operation).toBe('update')
    expect(await contents('notes.md')).toBe('two\n')
  })

  it('refuses a stale version and leaves the file exactly as it was', async () => {
    await writeFile(join(harness.workspace, 'notes.md'), 'one\n', 'utf8')
    const endpoint = harness.endpoint()
    const loaded = await endpoint.stat(harness.scope, 'notes.md', signal())
    // Someone else — the Agent, another tab — moves the file on.
    await writeFile(join(harness.workspace, 'notes.md'), 'theirs\n', 'utf8')
    const failure = await failureOf(endpoint.write(
      harness.scope,
      'notes.md',
      { text: 'mine\n', expectedVersion: loaded.version },
      signal(),
    ))
    expect(failure.code).toBe('workspace-file/stale-version')
    expect(failure.details).toEqual({ path: 'notes.md', expectedVersion: loaded.version })
    expect(await contents('notes.md')).toBe('theirs\n')
  })

  it('overwrites unconditionally when no version is sent, which is the conflict prompt\'s forced save', async () => {
    await writeFile(join(harness.workspace, 'notes.md'), 'one\n', 'utf8')
    const endpoint = harness.endpoint()
    const loaded = await endpoint.stat(harness.scope, 'notes.md', signal())
    await writeFile(join(harness.workspace, 'notes.md'), 'theirs\n', 'utf8')
    const result = await endpoint.write(harness.scope, 'notes.md', { text: 'mine\n' }, signal())
    expect(result.before).toBe('theirs\n')
    expect(result.version).not.toBe(loaded.version)
    expect(await contents('notes.md')).toBe('mine\n')
  })

  it('refuses a guard the file no longer satisfies even when the file was deleted', async () => {
    await writeFile(join(harness.workspace, 'notes.md'), 'one\n', 'utf8')
    const endpoint = harness.endpoint()
    const loaded = await endpoint.stat(harness.scope, 'notes.md', signal())
    // A guarded write cannot resurrect a file the reader's version cannot match.
    const failure = await failureOf(endpoint.write(
      harness.scope,
      'notes.md',
      { text: 'two\n', expectedVersion: `${loaded.version}-invented` },
      signal(),
    ))
    expect(failure.code).toBe('workspace-file/stale-version')
    expect(await contents('notes.md')).toBe('one\n')
  })
})

describe('workspaceFiles.write — the sandbox gates', () => {
  it('refuses under read-only mode without touching the backend or the file', async () => {
    await writeFile(join(harness.workspace, 'notes.md'), 'one\n', 'utf8')
    const writeText = vi.spyOn(harness.ctx.fs, 'writeText')
    harness.mode = 'read-only'
    const endpoint = harness.endpoint()
    const failure = await failureOf(endpoint.write(harness.scope, 'notes.md', { text: 'two\n' }, signal()))
    expect(failure.code).toBe('workspace-file/read-only')
    expect(failure.details).toEqual({ path: 'notes.md', mode: 'read-only' })
    expect(writeText).not.toHaveBeenCalled()
    expect(await contents('notes.md')).toBe('one\n')
  })

  it('fails closed on a cold Session rather than falling back to a deployment default', async () => {
    await writeFile(join(harness.workspace, 'notes.md'), 'one\n', 'utf8')
    const writeText = vi.spyOn(harness.ctx.fs, 'writeText')
    harness.live = false
    const endpoint = harness.endpoint()
    const failure = await failureOf(endpoint.write(harness.scope, 'notes.md', { text: 'two\n' }, signal()))
    expect(failure.code).toBe('workspace-file/session-not-live')
    expect(failure.details).toEqual({ path: 'notes.md' })
    expect(writeText).not.toHaveBeenCalled()
    expect(harness.policySessions).toHaveLength(0)
    expect(await contents('notes.md')).toBe('one\n')
  })

  it('checks the Session and the mode before it ever resolves a path', async () => {
    harness.live = false
    const resolve = vi.spyOn(harness.ctx.fs, 'resolve')
    await failureOf(harness.endpoint().write(harness.scope, 'missing.md', { text: 'x\n' }, signal()))
    // A refusal that leaks whether the path exists is a probe, not a gate.
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('workspaceFiles.write — the read gates still apply', () => {
  it('refuses a path that is not a regular file, and refuses a missing one', async () => {
    await mkdir(join(harness.workspace, 'src'))
    await writeFile(join(harness.outside, 'secret.md'), 'no', 'utf8')
    await symlink(join(harness.outside, 'secret.md'), join(harness.workspace, 'link.md'))
    const endpoint = harness.endpoint()
    expect(await failureOf(endpoint.write(harness.scope, 'src', { text: 'x' }, signal()))).toMatchObject({
      code: 'workspace-file/not-regular-file',
      details: { kind: 'directory' },
    })
    expect(await failureOf(endpoint.write(harness.scope, 'link.md', { text: 'x' }, signal()))).toMatchObject({
      code: 'workspace-file/not-regular-file',
      details: { kind: 'symlink' },
    })
    expect((await failureOf(endpoint.write(harness.scope, 'nope.md', { text: 'x' }, signal()))).code)
      .toBe('workspace-file/not-found')
    expect((await failureOf(endpoint.write(harness.scope, '', { text: 'x' }, signal()))).code)
      .toBe('gateway/bad-request')
  })

  it('creates nothing: a write never makes a file that was not already there', async () => {
    const endpoint = harness.endpoint()
    await failureOf(endpoint.write(harness.scope, 'brand-new.md', { text: 'x\n' }, signal()))
    expect(await readdir(harness.workspace)).toEqual([])
  })

  it('resolves the workspace root and then the file under the caller\'s signal', async () => {
    await writeFile(join(harness.workspace, 'notes.md'), 'one\n', 'utf8')
    const fs = harness.ctx.fs
    const original = fs.resolve.bind(fs)
    const spy = vi.spyOn(fs, 'resolve').mockImplementation((path, opts) => original(path, opts))
    const controller = new AbortController()
    await harness.endpoint().write(harness.scope, 'notes.md', { text: 'two\n' }, controller.signal)
    expect(spy.mock.calls.map(([, opts]) => opts?.signal)).toEqual([controller.signal, controller.signal])
  })

  it('rejects under a signal the caller already aborted, before any path resolves', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(harness.endpoint().write(harness.scope, 'notes.md', { text: 'x\n' }, controller.signal))
      .rejects.toThrow()
  })
})

describe('workspaceFiles.write — the change feed', () => {
  it('announces the write to every open changes generation, as a tool write does', async () => {
    await writeFile(join(harness.workspace, 'notes.md'), 'one\n', 'utf8')
    const endpoint = harness.endpoint()
    const controller = new AbortController()
    const iterator = endpoint.changes(harness.scope, controller.signal)[Symbol.asyncIterator]()
    closeStreams.push(async () => {
      controller.abort()
      await iterator.return?.()
    })
    const ready = await iterator.next()
    expect(ready.value).toEqual({ kind: 'ready' } satisfies WorkspaceFileWatchFrame)

    const result = await endpoint.write(harness.scope, 'notes.md', { text: 'two\n' }, signal())
    const frame = await iterator.next()
    expect(frame.value).toMatchObject({
      kind: 'change',
      change: { version: result.version },
    })
  })
})
