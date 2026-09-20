/**
 * The task-report card: the facts it states for a written report, its failure
 * copy when nothing was written, the open gesture, and its absence on a Turn
 * that recorded no report.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { TaskReportEventData } from '@deepseek-ai/dsh-task-report/types'
import { TaskReportCard, type TaskReportCardProps } from '../src/client/TaskReportCard.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: TaskReportCardProps['t'] = makeTranslate(zh, commonZh)

/** One report payload as the Host records it. */
function report(over: Partial<TaskReportEventData> = {}): TaskReportEventData {
  return { turn: 1, reason: 'completed', changes: [], verification: [], ...over }
}

/** Render the card over one Turn whose data does or does not carry a report. */
function renderCard(payload: TaskReportEventData | undefined) {
  const openFile = vi.fn()
  const props = {
    turn: {
      turn: 1,
      data: {
        get: (key: string) => (key === 'taskReport' && payload !== undefined ? { report: payload } : undefined),
      },
    },
    seq: 9,
    openFile,
    t,
  } as unknown as TaskReportCardProps
  render(<TaskReportCard {...props} />)
  return { openFile }
}

describe('TaskReportCard', () => {
  it('states the changed-file, line, and verification facts and opens the report', () => {
    const { openFile } = renderCard(report({
      path: '.dsh/reports/turn-1.md',
      changes: [
        { path: 'a.ts', kind: 'update', added: 3, removed: 1 },
        { path: 'b.ts', kind: 'create', added: 4, removed: 0 },
      ],
      verification: [
        { command: 'pnpm test', status: 'passed', exitCode: 0 },
        { command: 'pnpm lint', status: 'passed', exitCode: 0 },
        { command: 'pnpm build', status: 'failed', exitCode: 2 },
        { command: 'pnpm check', status: 'unknown' },
      ],
    }))

    expect(screen.getByText(zh['row.title'])).toBeDefined()
    expect(screen.getByText('2 个文件 · +7 / -1 · 2 项通过 · 1 项失败 · 1 项结果未知')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['row.open'] }))
    expect(openFile).toHaveBeenCalledWith('.dsh/reports/turn-1.md')
  })

  it('renders a verification-only report without a change fact', () => {
    renderCard(report({ path: 'r.md', verification: [{ command: 'vitest', status: 'failed', exitCode: 1 }] }))
    expect(screen.getByText('1 项失败')).toBeDefined()
  })

  it('renders a report whose facts are all zero', () => {
    renderCard(report({ path: 'r.md' }))
    expect(screen.getByText(zh['row.title'])).toBeDefined()
    expect(screen.getByRole('button', { name: zh['row.open'] })).toBeDefined()
  })

  it('states why the report was not written and offers no open gesture', () => {
    renderCard(report({ error: 'the session has no working directory' }))
    expect(screen.getByText('未写入：the session has no working directory')).toBeDefined()
    expect(screen.queryByRole('button', { name: zh['row.open'] })).toBeNull()
  })

  it('renders an unexplained refusal without inventing a reason', () => {
    renderCard(report({}))
    expect(screen.getByText('未写入：')).toBeDefined()
  })

  it('renders nothing when the Turn recorded no report', () => {
    const { container } = render(
      <TaskReportCard
        {...{
          turn: { turn: 1, data: { get: () => undefined } },
          seq: 9,
          openFile: vi.fn(),
          t,
        } as unknown as TaskReportCardProps}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
