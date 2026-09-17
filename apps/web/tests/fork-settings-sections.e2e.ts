// Web e2e scenario: the three Settings sections this fork adds over its own
// Remote namespaces — token usage, the durable project board, and the outcome
// signals — each read once through the assembled Host composition.
//
// This is the assembled-app guard for the Remote arity contract: a section that
// calls a namespace method short of its declared parameters fails inside the
// Client gateway before any request leaves the page, so the panel renders its
// failed-read notice while the Host stays healthy. Zero model calls.
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

/** One section under test: its nav label and the heading its ready state draws. */
const SECTIONS = [
  { nav: '用量', heading: 'Token 用量与费用', failed: '暂时无法读取用量，请重试。' },
  { nav: '项目', heading: '项目看板', failed: '暂时无法读取项目，请重试。' },
  { nav: '有效性', heading: '结果信号', failed: '暂时无法读取结果信号，请重试。' },
] as const

describe('web e2e: fork Settings sections read their Remote namespaces', () => {
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

  it('renders every fork section from its namespace instead of the failed-read notice', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-fork-settings-sections'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog: Locator = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })

    for (const section of SECTIONS) {
      await dialog.getByRole('button', { name: section.nav, exact: true }).click()
      await dialog.getByRole('heading', { name: section.heading }).waitFor({ timeout: 10_000 })
      expect(await dialog.getByText(section.failed).count()).toBe(0)
      expect(await dialog.locator('[role="alert"]').count()).toBe(0)
    }

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)
})
