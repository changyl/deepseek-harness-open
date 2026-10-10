/**
 * The turn fold: request, closing text, applied hunks, reported creates, and
 * verification outcomes read from one turn's log window, plus the bounds and the
 * malformed payloads that must contribute nothing.
 */
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { foldTaskReport, type TaskReportFoldOptions } from '../src/fold.ts'

/** Narrow one hand-built event into the session event union. */
function event(type: SessionEvent['type'], data: unknown, seq: number): SessionEvent {
  return { type, seq: SessionSeq(seq), time: 0, data } as SessionEvent
}

/** One user message carrying plain text. */
function userMessage(text: string, source: unknown = { kind: 'user' }, seq = 0): SessionEvent {
  return event('user/message', {
    role: 'user',
    id: `m${String(seq)}`,
    content: [{ type: 'text', text }],
    source,
  }, seq)
}

/** One assistant message carrying plain text. */
function assistantMessage(text: string, turn = 1, seq = 0): SessionEvent {
  return event('assistant/message', {
    turn,
    step: 1,
    stream: [],
    message: { role: 'assistant', id: `a${String(seq)}`, content: text === '' ? [] : [{ type: 'text', text }] },
  }, seq)
}

/** One bash call with its command line. */
function bashCall(command: string, callId = 'call-1', turn = 1, seq = 0): SessionEvent {
  return event('tool/call', { turn, step: 1, callId, name: 'bash', arguments: JSON.stringify({ command }) }, seq)
}

/** One `write` call carrying the whole text it supplied. */
function writeCall(content: string, callId = 'call-1', turn = 1, seq = 0): SessionEvent {
  return event('tool/call', {
    turn,
    step: 1,
    callId,
    name: 'write',
    arguments: JSON.stringify({ file_path: 'src/new.ts', content }),
  }, seq)
}

/** One tool-role result message carrying a rendered text body and optional presentation meta. */
function toolResult(
  text: string,
  options: { callId?: string; isError?: boolean; meta?: unknown; turn?: number } = {},
  seq = 0,
): SessionEvent {
  const callId = options.callId ?? 'call-1'
  return event('tool/result', {
    turn: options.turn ?? 1,
    step: 1,
    message: {
      role: 'tool',
      id: `r${String(seq)}`,
      source: { kind: 'tool', callId },
      toolCallId: callId,
      content: [{ type: 'text', text }],
      isError: options.isError ?? false,
    },
    ...(options.meta === undefined ? {} : { meta: options.meta }),
  }, seq)
}

/** One turn boundary pair around the supplied body. */
function turn(body: readonly SessionEvent[], turnNumber = 1): SessionEvent[] {
  return [
    event('turn/start', { turn: turnNumber }, 0),
    ...body.map((entry, index) => ({ ...entry, seq: SessionSeq(index + 1) })),
    event('turn/end', { turn: turnNumber, reason: { kind: 'completed' } }, body.length + 1),
  ]
}

const OPTIONS: TaskReportFoldOptions = {
  turn: 1,
  verifyPatterns: ['test', 'vitest', 'typecheck'],
  maxTextLength: 600,
  maxChanges: 50,
  maxVerifications: 20,
}

/** Fold one assembled log. */
function fold(events: readonly SessionEvent[], inherited = 0, over: Partial<TaskReportFoldOptions> = {}) {
  return foldTaskReport(events, inherited, { ...OPTIONS, ...over })
}

describe('foldTaskReport', () => {
  it('reads the request, the closing text, the changed files, and the verification', () => {
    const result = fold(turn([
      userMessage('Fix the parser', { kind: 'user' }, 1),
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'edit', arguments: '{}' }, 2),
      toolResult('applied', { callId: 'c1', meta: { diffs: [{ path: 'src/a.ts', oldText: 'a\nb', newText: 'a\nc\nd' }] } }, 3),
      bashCall('pnpm run test', 'c2', 1, 4),
      toolResult('ok\n[exit code: 0]', { callId: 'c2' }, 5),
      assistantMessage('Done, tests pass.', 1, 6),
    ]))

    expect(result).toEqual({
      reason: 'completed',
      request: 'Fix the parser',
      summary: 'Done, tests pass.',
      changes: [{ path: 'src/a.ts', kind: 'update', added: 3, removed: 2 }],
      verification: [{ command: 'pnpm run test', status: 'passed', exitCode: 0 }],
    })
  })

  it('reports a create from the write result operation and the call text', () => {
    const result = fold(turn([
      writeCall('one\ntwo', 'c1', 1, 1),
      toolResult('wrote', { callId: 'c1', meta: { operation: 'create', path: 'src/new.ts', diffs: [] } }, 2),
    ]))
    expect(result.changes).toEqual([{ path: 'src/new.ts', kind: 'create', added: 2, removed: 0 }])
  })

  it('reports a create with zero added lines when its write call is absent from the window', () => {
    const result = fold(turn([
      toolResult('wrote', { callId: 'c1', meta: { operation: 'create', path: 'src/new.ts', diffs: [] } }, 1),
    ]))
    expect(result.changes).toEqual([{ path: 'src/new.ts', kind: 'create', added: 0, removed: 0 }])
  })

  it('ignores a create whose result names no usable path', () => {
    const result = fold(turn([
      toolResult('wrote', { callId: 'c1', meta: { operation: 'create', path: 7, diffs: [] } }, 1),
      toolResult('wrote', { callId: 'c2', meta: { operation: 'create', path: '', diffs: [] } }, 2),
    ]))
    expect(result.changes).toEqual([])
  })

  it('records no change for an update whose result carries no hunk', () => {
    const result = fold(turn([
      writeCall('same\n', 'c1', 1, 1),
      toolResult('wrote', { callId: 'c1', meta: { operation: 'update', path: 'src/a.ts', diffs: [] } }, 2),
    ]))
    expect(result.changes).toEqual([])
  })

  it('keeps the last hunk of a path but its first position', () => {
    const result = fold(turn([
      toolResult('a', { callId: 'c1', meta: { diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] } }, 1),
      toolResult('b', { callId: 'c2', meta: { diffs: [{ path: 'b.ts', oldText: 'x', newText: 'y' }] } }, 2),
      toolResult('c', { callId: 'c3', meta: { diffs: [{ path: 'a.ts', oldText: 'y', newText: 'y\nz' }] } }, 3),
    ]))
    expect(result.changes).toEqual([
      { path: 'a.ts', kind: 'update', added: 2, removed: 1 },
      { path: 'b.ts', kind: 'update', added: 1, removed: 1 },
    ])
  })

  it('reads the request from the user source only and the summary from the last assistant message', () => {
    const result = fold(turn([
      userMessage('injected', { kind: 'plugin', plugin: 'context' }, 1),
      userMessage('   ', { kind: 'user' }, 2),
      userMessage('real request', { kind: 'user' }, 3),
      assistantMessage('first', 1, 4),
      assistantMessage('final', 1, 5),
    ]))
    expect(result.request).toBe('real request')
    expect(result.summary).toBe('final')
  })

  it('omits a request and a summary the turn never recorded', () => {
    const result = fold(turn([]))
    expect(result.request).toBeUndefined()
    expect(result.summary).toBeUndefined()
  })

  it('skips a turn window that never closed and turns the session did not run', () => {
    const open = [event('turn/start', { turn: 1 }, 0), assistantMessage('partial', 1, 1)]
    expect(fold(open)).toEqual({ reason: 'completed', changes: [], verification: [] })

    const other = turn([userMessage('second turn', { kind: 'user' }, 1)], 2)
    expect(fold(other).request).toBeUndefined()
  })

  it('ignores fork-inherited events', () => {
    const log = turn([userMessage('seeded request', { kind: 'user' }, 1), assistantMessage('seeded', 1, 2)])
    expect(fold(log, log.length).request).toBeUndefined()
  })

  it('records the turn-end reason', () => {
    const events = [...turn([])]
    events[events.length - 1] = event('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }, 1)
    expect(fold(events).reason).toBe('aborted')
  })

  it('keeps only verification commands that match a pattern', () => {
    const result = fold(turn([
      bashCall('pnpm run test:gui', 'c1', 1, 1),
      toolResult('[exit code: 0]', { callId: 'c1' }, 2),
      bashCall('ls -la', 'c2', 1, 3),
      toolResult('files', { callId: 'c2' }, 4),
      bashCall('pnpm run typecheck', 'c3', 1, 5),
      toolResult('[exit code: 2]', { callId: 'c3' }, 6),
    ]))
    expect(result.verification).toEqual([
      { command: 'pnpm run test:gui', status: 'passed', exitCode: 0 },
      { command: 'pnpm run typecheck', status: 'failed', exitCode: 2 },
    ])
  })

  it('reads timeouts, signals, error results, and missing markers', () => {
    const result = fold(turn([
      bashCall('pnpm test', 'c1', 1, 1),
      toolResult('partial\n[timed out after 1000ms]', { callId: 'c1' }, 2),
      bashCall('pnpm test --watch', 'c2', 1, 3),
      toolResult('killed\n[killed by signal: SIGKILL]', { callId: 'c2' }, 4),
      bashCall('vitest run', 'c3', 1, 5),
      toolResult('boom', { callId: 'c3', isError: true }, 6),
      bashCall('vitest related', 'c4', 1, 7),
      toolResult('no marker at all', { callId: 'c4' }, 8),
    ]))
    expect(result.verification).toEqual([
      { command: 'pnpm test', status: 'failed' },
      { command: 'pnpm test --watch', status: 'failed' },
      { command: 'vitest run', status: 'failed' },
      { command: 'vitest related', status: 'unknown' },
    ])
  })

  it('ignores non-bash calls, malformed arguments, and empty commands', () => {
    const result = fold(turn([
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"command":"pnpm test"}' }, 1),
      toolResult('[exit code: 0]', { callId: 'c1' }, 2),
      event('tool/call', { turn: 1, step: 1, callId: 'c2', name: 'bash', arguments: 'not json' }, 3),
      toolResult('test', { callId: 'c2' }, 4),
      event('tool/call', { turn: 1, step: 1, callId: 'c3', name: 'bash', arguments: '{"command":"   "}' }, 5),
      toolResult('test', { callId: 'c3' }, 6),
      event('tool/call', { turn: 1, step: 1, callId: 'c4', name: 'bash', arguments: '["pnpm test"]' }, 7),
      toolResult('test', { callId: 'c4' }, 8),
      event('tool/call', { turn: 1, step: 1, callId: 'c5', name: 'bash', arguments: '{"command":7}' }, 9),
      toolResult('test', { callId: 'c5' }, 10),
    ]))
    expect(result.verification).toEqual([])
  })

  it('ignores malformed recorded diffs and counts an empty text as zero lines', () => {
    const result = fold(turn([
      toolResult('a', { callId: 'c1', meta: 'not an object' }, 1),
      toolResult('b', { callId: 'c2', meta: { diffs: 'not an array' } }, 2),
      toolResult('c', {
        callId: 'c3',
        meta: { diffs: [null, { path: 7 }, { path: 'ok.ts', newText: 3 }, { path: 'old.ts', oldText: 2, newText: 'x' }] },
      }, 3),
      toolResult('d', { callId: 'c4', meta: { diffs: [{ path: 'empty.ts', oldText: '', newText: '' }] } }, 4),
    ]))
    expect(result.changes).toEqual([{ path: 'empty.ts', kind: 'update', added: 0, removed: 0 }])
  })

  it('bounds the request, the summary, the change list, and the verification list', () => {
    const long = 'x'.repeat(700)
    const result = fold(turn([
      userMessage(long, { kind: 'user' }, 1),
      assistantMessage(long, 1, 2),
      toolResult('a', { callId: 'c1', meta: { diffs: [
        { path: 'a.ts', oldText: 'x', newText: 'y' },
        { path: 'b.ts', oldText: 'x', newText: 'y' },
      ] } }, 3),
      bashCall('pnpm test', 'c2', 1, 4),
      toolResult('[exit code: 0]', { callId: 'c2' }, 5),
      bashCall('pnpm test:gui', 'c3', 1, 6),
      toolResult('[exit code: 0]', { callId: 'c3' }, 7),
    ]), 0, { maxTextLength: 12, maxChanges: 1, maxVerifications: 1 })

    expect(result.request).toBe(`${'x'.repeat(12)}…`)
    expect(result.summary).toBe(`${'x'.repeat(12)}…`)
    expect(result.changes).toHaveLength(1)
    expect(result.verification).toEqual([{ command: 'pnpm test', status: 'passed', exitCode: 0 }])
  })

  it('ignores a result whose message names no paired tool call', () => {
    const result = fold(turn([
      bashCall('pnpm test', 'c1', 1, 1),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          id: 'r',
          source: { kind: 'tool', callId: 'other' },
          toolCallId: 'other',
          content: [{ type: 'text', text: '[exit code: 0]' }],
        },
      }, 2),
    ]))
    expect(result.verification).toEqual([])
    expect(result.changes).toEqual([])
  })

  it('joins only the text blocks of a message', () => {
    const notAList = event('user/message', { role: 'user', id: 'm', source: { kind: 'user' }, content: 'nope' }, 1)
    expect(fold(turn([notAList])).request).toBeUndefined()

    const mixedBlocks = event('user/message', {
      role: 'user',
      id: 'm2',
      source: { kind: 'user' },
      content: [{ type: 'reasoning', text: 'ignored' }, { type: 'text', text: 'kept' }],
    }, 1)
    expect(fold(turn([mixedBlocks])).request).toBe('kept')
  })

  it('reads only text blocks when it parses a tool result outcome', () => {
    const result = fold(turn([
      bashCall('pnpm test', 'c1', 1, 1),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          id: 'r',
          source: { kind: 'tool', callId: 'c1' },
          toolCallId: 'c1',
          content: [{ type: 'reasoning', text: '[exit code: 0]' }],
        },
      }, 2),
    ]))
    expect(result.verification).toEqual([{ command: 'pnpm test', status: 'unknown' }])
  })

  it('skips an empty assistant message when it looks for the closing text', () => {
    const result = fold(turn([
      assistantMessage('the answer', 1, 1),
      assistantMessage('   ', 1, 2),
    ]))
    expect(result.summary).toBe('the answer')
  })

  it('leaves out a verification whose call the turn never logged', () => {
    const result = fold(turn([toolResult('[exit code: 0]', { callId: 'orphan' }, 1)]))
    expect(result.verification).toEqual([])
  })
})
