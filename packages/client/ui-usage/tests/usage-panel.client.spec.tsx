// @vitest-environment jsdom
/**
 * The usage panel's rendering rules: the loading, failed, and ready reads;
 * the failure notice with its rejection reason; the totals and per-route
 * table; the missing-rate-card and incomplete-amount notices; the unpriced
 * list; and the refresh gesture.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { UsageCostWire, UsageReportWire, UsageRouteTotalsWire } from '@deepseek-ai/dsh-api-usage/types'
import { UsagePanel } from '../src/client/UsagePanel.tsx'
import type { UsagePanelProps } from '../src/client/UsagePanel.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function route(
  provider: string,
  model: string,
  over: Partial<UsageRouteTotalsWire> = {},
): UsageRouteTotalsWire {
  return {
    provider,
    model,
    sessions: 1,
    steps: 2,
    unknownUsageSteps: 0,
    uncachedInputTokens: 1_200,
    outputTokens: 340,
    cacheReadTokens: 56,
    cacheWriteTokens: 7,
    ...over,
  }
}

/** Rate card used unless a test asks for a deployment without one. */
const RATE_CARD: UsageCostWire = {
  currency: 'CNY',
  pricingVersion: 'v3',
  totalMicros: 12_500_000,
  complete: false,
  routes: [
    { provider: 'deepseek', model: 'chat', micros: 12_500_000, priced: true },
    { provider: 'local', model: 'llama', micros: 0, priced: false },
  ],
}

/**
 * One report. The corpus fields come from the defaults, and `null` states a
 * deployment whose composition mounts no rate card.
 */
function report(
  over: Partial<Omit<UsageReportWire, 'cost'>> = {},
  cost: UsageCostWire | null = RATE_CARD,
): UsageReportWire {
  const corpus = {
    totals: {
      sessions: 2,
      turns: 3,
      steps: 4,
      unknownUsageSteps: 1,
      uncachedInputTokens: 12_000,
      outputTokens: 3_400,
      cacheReadTokens: 560,
      cacheWriteTokens: 70,
    },
    routes: [route('deepseek', 'chat'), route('local', 'llama')],
    unpriced: [{ provider: 'local', model: 'llama' }],
    ...over,
  }
  return cost === null ? corpus : { ...corpus, cost }
}

/**
 * Render the panel over one scripted query.
 * @param query - the Remote face the section calls.
 * @returns the query mock, so a test can script later reads.
 */
function renderSection(query: UsagePanelProps['query']) {
  const props = {
    t: makeTranslate(en),
    query,
  } as unknown as UsagePanelProps
  render(<UsagePanel {...props} />)
}

describe('the usage panel', () => {
  it('reports the read in progress, then the totals and routes it answered', async () => {
    const query = vi.fn(() => Promise.resolve(report()))
    renderSection(query)
    expect(screen.getByRole('status').textContent).toBe(en.loading)

    expect(await screen.findByRole('heading', { name: en.title })).toBeDefined()
    expect(query).toHaveBeenCalledTimes(1)

    const totals = screen.getByText(en['totals.heading']).nextElementSibling as HTMLElement
    for (const [label, value] of [
      [en['totals.sessions'], '2'],
      [en['totals.turns'], '3'],
      [en['totals.steps'], '4'],
      [en['totals.unknownSteps'], '1'],
      [en['tokens.uncachedInput'], '12000'],
      [en['tokens.output'], '3400'],
      [en['tokens.cacheRead'], '560'],
      [en['tokens.cacheWrite'], '70'],
    ] as const) {
      const term = within(totals).getByText(label)
      expect(term.nextElementSibling?.textContent).toBe(value)
    }

    const rows = within(screen.getAllByRole('rowgroup')[1]!).getAllByRole('row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByRole('rowheader').textContent).toBe('deepseek/chat')
    expect(within(rows[0]!).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual(['1', '2', '1200', '340', '56', '7'])

    expect(screen.getByText('12.5 CNY')).toBeDefined()
    expect(screen.getByText(en['cost.version'].replace('{version}', 'v3'))).toBeDefined()
    expect(screen.getByText(en['cost.incomplete'])).toBeDefined()
    expect(screen.getByText(en['unpriced.heading'])).toBeDefined()
    const unpriced = screen.getByText(en['unpriced.heading']).nextElementSibling as HTMLElement
    expect(within(unpriced).getByText('local/llama')).toBeDefined()
  })

  it('renders a whole-unit amount without a fraction', async () => {
    renderSection(() => Promise.resolve(report({ unpriced: [] }, {
      currency: 'USD',
      pricingVersion: 'v1',
      totalMicros: 2_000_000,
      complete: true,
      routes: [{ provider: 'deepseek', model: 'chat', micros: 2_000_000, priced: true }],
    })))

    expect(await screen.findByText('2 USD')).toBeDefined()
    expect(screen.queryByText(en['cost.incomplete'])).toBeNull()
    expect(screen.queryByText(en['unpriced.heading'])).toBeNull()
  })

  it('states an empty selection and a deployment with no rate card', async () => {
    renderSection(() => Promise.resolve(report({ routes: [], unpriced: [] }, null)))

    expect(await screen.findByText(en['routes.empty'])).toBeDefined()
    expect(screen.getByText(en['cost.none'])).toBeDefined()
  })

  it('offers a retry after a failed read and keeps the rejection reason', async () => {
    const query = vi.fn()
      .mockRejectedValueOnce(new Error('usage.query failed: usage/unavailable: no provider'))
      .mockResolvedValueOnce(report({ unpriced: [] }, null))
    renderSection(query)

    expect((await screen.findByRole('alert')).textContent).toBe(en.failed)
    expect(screen.getByText(
      en['failed.reason'].replace('{reason}', 'usage.query failed: usage/unavailable: no provider'),
    )).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(await screen.findByRole('heading', { name: en.title })).toBeDefined()
    expect(query).toHaveBeenCalledTimes(2)
    expect(screen.getByText(en['cost.none'])).toBeDefined()
  })

  it('reports a rejection that is not an Error verbatim', async () => {
    renderSection(vi.fn().mockRejectedValue('gateway/closed'))

    expect((await screen.findByRole('alert')).textContent).toBe(en.failed)
    expect(screen.getByText(en['failed.reason'].replace('{reason}', 'gateway/closed'))).toBeDefined()
  })

  it('holds the refresh control while the next read is in flight', async () => {
    let settle = (value: UsageReportWire): void => { void value }
    const second = new Promise<UsageReportWire>((resolve) => { settle = resolve })
    const query = vi.fn()
      .mockResolvedValueOnce(report())
      .mockImplementationOnce(() => second)
    renderSection(query)

    await screen.findByRole('heading', { name: en.title })
    const button = screen.getByRole('button', { name: en.refresh })
    fireEvent.click(button)
    expect((button as HTMLButtonElement).disabled).toBe(true)

    settle(report({ unpriced: [] }, null))
    await waitFor(() => { expect(screen.getByText(en['cost.none'])).toBeDefined() })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })
})
