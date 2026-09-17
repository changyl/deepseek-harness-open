// Web e2e scenario: the fork's global panels — the durable project board, token
// usage, and the outcome signals — each opened from its sidebar row and read
// once through the assembled Host composition.
//
// This is the assembled-app guard for the whole panel path: a `sidebar.panellist`
// row selects the registered `main` key of the same id, the centre column renders
// that panel from its Remote namespace, and the Settings dialog no longer offers
// the three as sections. Zero model calls.
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

/** One panel under test: its sidebar row label and the heading its ready state draws. */
const PANELS = [
  { row: '项目', heading: '项目看板', failed: '暂时无法读取项目，请重试。' },
  { row: '用量', heading: 'Token 用量与费用', failed: '暂时无法读取用量，请重试。' },
  { row: '有效性', heading: '结果信号', failed: '暂时无法读取结果信号，请重试。' },
] as const

describe('web e2e: fork global panels read their Remote namespaces', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens every fork panel from its sidebar row instead of the Settings dialog', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-fork-global-panels'))
    const nav: Locator = page.getByRole('navigation', { name: '全局面板' })
    await nav.waitFor({ timeout: 30_000 })
    expect(await nav.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))))
      .toEqual(PANELS.map(panel => panel.row))

    for (const panel of PANELS) {
      const row = nav.getByRole('button', { name: panel.row, exact: true })
      await row.click()
      await expect.poll(() => row.getAttribute('aria-current'), { timeout: 10_000 }).toBe('page')
      const surface = page.getByRole('region', { name: panel.heading })
      await surface.waitFor({ timeout: 10_000 })
      expect(await surface.getByText(panel.failed).count()).toBe(0)
      expect(await surface.locator('[role="alert"]').count()).toBe(0)
    }

    // The three are global panels now: the Settings dialog must not offer them.
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog: Locator = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '通用设置' }).waitFor({ timeout: 10_000 })
    for (const panel of PANELS) {
      expect(await dialog.getByRole('button', { name: panel.row, exact: true }).count()).toBe(0)
    }
    await dialog.getByRole('button', { name: '关闭' }).click()

    // Starting a New Session returns the centre column to the Conversation.
    await page.getByRole('button', { name: '新建会话', exact: true }).first().click()
    const lastRow = nav.getByRole('button', { name: PANELS[2].row, exact: true })
    await expect.poll(() => lastRow.getAttribute('aria-current'), { timeout: 10_000 }).toBeNull()

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 180_000)
})
