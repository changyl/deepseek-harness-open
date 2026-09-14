/**
 * The Markdown projection: the document a user pastes into a pull request, its
 * empty states, and the escaping that keeps a path or command from breaking a
 * table.
 */
import { describe, expect, it } from 'vitest'
import { renderTaskReport } from '../src/render.ts'

const BASE = {
  turn: 3,
  reason: 'completed',
  path: '.dsh/reports/turn-3.md',
  generatedAt: '2026-09-14T10:00:00.000Z',
}

describe('renderTaskReport', () => {
  it('renders the header, the request, the summary, the change table, and the verification table', () => {
    const markdown = renderTaskReport({
      ...BASE,
      result: {
        reason: 'completed',
        request: 'Fix the parser',
        summary: 'Done.',
        changes: [{ path: 'src/a.ts', kind: 'update', added: 3, removed: 2 }],
        verification: [{ command: 'pnpm run test', status: 'passed', exitCode: 0 }],
      },
    })

    expect(markdown).toContain('# Task report — turn 3')
    expect(markdown).toContain('- **Turn:** 3 (completed)')
    expect(markdown).toContain('- **Report:** `.dsh/reports/turn-3.md`')
    expect(markdown).toContain('- **Generated:** 2026-09-14T10:00:00.000Z')
    expect(markdown).toContain('Fix the parser')
    expect(markdown).toContain('Done.')
    expect(markdown).toContain('## Changes (1)')
    expect(markdown).toContain('| `src/a.ts` | update | +3 / -2 |')
    expect(markdown).toContain('## Verification (1)')
    expect(markdown).toContain('| `pnpm run test` | passed (exit 0) |')
    expect(markdown.endsWith('\n')).toBe(true)
  })

  it('states the empty cases for a turn with nothing to report', () => {
    const markdown = renderTaskReport({ ...BASE, result: { reason: 'aborted', changes: [], verification: [] } })
    expect(markdown).toContain('_No user request was recorded for this turn._')
    expect(markdown).toContain('_The turn produced no closing message._')
    expect(markdown).toContain('## Changes (0)')
    expect(markdown).toContain('_No file change was recorded for this turn._')
    expect(markdown).toContain('_No verification command ran in this turn._')
  })

  it('renders a verification without a parsed exit code', () => {
    const markdown = renderTaskReport({
      ...BASE,
      result: { reason: 'completed', changes: [], verification: [{ command: 'vitest', status: 'unknown' }] },
    })
    expect(markdown).toContain('| `vitest` | unknown |')
  })

  it('escapes backticks and pipes so a path cannot break the table', () => {
    const markdown = renderTaskReport({
      ...BASE,
      path: '.dsh/re`ports|turn-3.md',
      result: {
        reason: 'completed',
        changes: [{ path: 'src/a`b|c.ts', kind: 'create', added: 1, removed: 0 }],
        verification: [{ command: 'pnpm test --reporter=dot|json', status: 'failed', exitCode: 1 }],
      },
    })
    expect(markdown).toContain('`src/a\'b\\|c.ts`')
    expect(markdown).toContain('`pnpm test --reporter=dot\\|json`')
  })
})
