// @vitest-environment jsdom
/**
 * The effectiveness section's rendering rules: the loading, failed, and ready
 * reads; the totals grid; the category list; the route table; the session rows
 * and their truncation notice; the insufficient-signal notice; and the refresh
 * gesture.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  EffectivenessProjectionWire,
  EffectivenessReportWire,
} from '@deepseek-ai/dsh-api-effectiveness/types'
import { EffectivenessSection } from '../src/client/EffectivenessSection.tsx'
import type { EffectivenessSectionProps } from '../src/client/EffectivenessSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function projection(over: Partial<EffectivenessProjectionWire> = {}): EffectivenessProjectionWire {
  return {
    feedback: { positive: 3, negative: 1, byCategory: {} },
    changes: { accepted: 4, reverted: 1, undecided: 2 },
    verification: { passed: 5, failed: 1, unknown: 0 },
    turnsWithSignal: 6,
    ...over,
  }
}

function report(over: Partial<EffectivenessReportWire> = {}): EffectivenessReportWire {
  return {
    totals: { ...projection(), sessions: 2 },
    routes: [
      { ...projection(), provider: 'deepseek', model: 'chat', sessions: 2 },
      { ...projection({ turnsWithSignal: 0 }), provider: 'local', model: 'llama', sessions: 1 },
    ],
    sessions: [
      {
        ...projection(),
        sessionId: 'session-1',
        createdAt: Date.UTC(2026, 8, 16, 12, 0, 0),
        routes: [{ provider: 'deepseek', model: 'chat' }],
      },
    ],
    truncated: false,
    ...over,
  }
}

/**
 * Render the section over one scripted query.
 * @param query - the Remote face the section calls.
 */
function renderSection(query: EffectivenessSectionProps['query']) {
  const props = {
    close: vi.fn(),
    t: makeTranslate(en),
    query,
  } as unknown as EffectivenessSectionProps
  render(<EffectivenessSection {...props} />)
}

describe('the effectiveness section', () => {
  it('reports the read in progress, then the totals it answered', async () => {
    const query = vi.fn(() => Promise.resolve(report()))
    renderSection(query)
    expect(screen.getByRole('status').textContent).toBe(en.loading)

    expect(await screen.findByRole('heading', { name: en.title })).toBeDefined()
    expect(query).toHaveBeenCalledTimes(1)

    const totals = screen.getByText(en['totals.heading']).nextElementSibling as HTMLElement
    for (const [label, value] of [
      [en['totals.sessions'], '2'],
      [en['totals.turns'], '6'],
      [en['feedback.positive'], '3'],
      [en['feedback.negative'], '1'],
      [en['changes.accepted'], '4'],
      [en['changes.reverted'], '1'],
      [en['changes.undecided'], '2'],
      [en['verification.passed'], '5'],
      [en['verification.failed'], '1'],
      [en['verification.unknown'], '0'],
    ] as const) {
      expect(within(totals).getByText(label).nextElementSibling?.textContent).toBe(value)
    }
    expect(screen.queryByText(en['feedback.categories'])).toBeNull()
    expect(screen.queryByText(en['signal.none'])).toBeNull()
  })

  it('lists only the categories that carry a judgment', async () => {
    renderSection(() => Promise.resolve(report({
      totals: {
        ...projection({
          feedback: { positive: 2, negative: 0, byCategory: { 'instruction-following': 2 } },
        }),
        sessions: 1,
      },
    })))

    expect(await screen.findByText(en['feedback.categories'])).toBeDefined()
    expect(screen.getByText(`${en['category.instruction-following']}: 2`)).toBeDefined()
    expect(screen.queryByText(`${en['category.task-result']}: 0`)).toBeNull()
  })

  it('states an empty corpus, an empty route table, and an empty session list', async () => {
    renderSection(() => Promise.resolve(report({
      totals: {
        ...projection({
          feedback: { positive: 0, negative: 0, byCategory: {} },
          changes: { accepted: 0, reverted: 0, undecided: 0 },
          verification: { passed: 0, failed: 0, unknown: 0 },
          turnsWithSignal: 0,
        }),
        sessions: 0,
      },
      routes: [],
      sessions: [],
    })))

    expect(await screen.findByText(en['signal.none'])).toBeDefined()
    expect(screen.getByText(en['routes.empty'])).toBeDefined()
    expect(screen.getByText(en['sessions.empty'])).toBeDefined()
  })

  it('renders the route rows, the session rows, and the truncation notice', async () => {
    renderSection(() => Promise.resolve(report({ truncated: true })))

    await screen.findByRole('heading', { name: en.title })
    const rows = within(screen.getAllByRole('rowgroup')[1]!).getAllByRole('row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByRole('rowheader').textContent).toBe('deepseek/chat')
    expect(within(rows[0]!).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual(['2', '6', '3', '1', '5', '1'])

    expect(screen.getByText('session-1')).toBeDefined()
    expect(screen.getByText(en['sessions.createdAt'].replace('{time}', '2026-09-16'))).toBeDefined()
    expect(screen.getByText(`${en['sessions.turns']}: 6`)).toBeDefined()
    expect(screen.getByText(en['sessions.truncated'])).toBeDefined()
  })

  it('offers a retry after a failed read', async () => {
    const query = vi.fn()
      .mockRejectedValueOnce(new Error('gateway/bad-request'))
      .mockResolvedValueOnce(report({ routes: [], sessions: [] }))
    renderSection(query)

    expect((await screen.findByRole('alert')).textContent).toBe(en.failed)
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(await screen.findByRole('heading', { name: en.title })).toBeDefined()
    expect(query).toHaveBeenCalledTimes(2)
    expect(screen.getByText(en['routes.empty'])).toBeDefined()
  })

  it('holds the refresh control while the next read is in flight', async () => {
    let settle = (value: EffectivenessReportWire): void => { void value }
    const second = new Promise<EffectivenessReportWire>((resolve) => { settle = resolve })
    const query = vi.fn()
      .mockResolvedValueOnce(report())
      .mockImplementationOnce(() => second)
    renderSection(query)

    await screen.findByRole('heading', { name: en.title })
    const button = screen.getByRole('button', { name: en.refresh })
    fireEvent.click(button)
    expect((button as HTMLButtonElement).disabled).toBe(true)

    settle(report({ totals: { ...projection(), sessions: 0 }, routes: [], sessions: [] }))
    await waitFor(() => { expect(screen.getByText(en['signal.none'])).toBeDefined() })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })
})
