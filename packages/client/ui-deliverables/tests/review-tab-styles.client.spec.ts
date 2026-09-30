/**
 * The review tab's split layout as CSS text. jsdom has no layout, so the
 * component suite cannot see the defect these rules prevent: a body that scrolls
 * its two columns is what keeps them at one offset in both directions. A column
 * that declares its own overflow becomes a second scroller — CSS computes
 * `overflow-y: auto` from a non-visible `overflow-x` — and the two sides then
 * move apart vertically, which is exactly what a reader comparing them sees.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/ReviewTab.module.css', import.meta.url)), 'utf8')
/** The sheet without comments, so a rule's own prose can never satisfy an assertion. */
const sheet = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

/** One rule's declarations, found by the selector that opens it. */
function declarations(selector: string): string {
  const rule = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(sheet)
  if (rule === null) throw new Error(`ReviewTab.module.css has no \`${selector}\` rule`)
  return rule[1] ?? ''
}

describe('ReviewTab.module.css split scroller', () => {
  it('keeps the body as the only scroller of the comparison', () => {
    expect(declarations('.body')).toContain('overflow: auto')
    // Neither the grid nor a side may scroll on its own: one offset, both sides.
    expect(declarations('.columns')).not.toContain('overflow')
    expect(declarations('.column')).not.toContain('overflow')
  })

  it('sizes both sides once from their longest line and fills a short comparison', () => {
    const columns = declarations('.columns')
    expect(columns).toContain('display: grid')
    expect(columns).toContain('grid-template-columns: minmax(max-content, 1fr) minmax(max-content, 1fr)')
    expect(columns).toContain('min-height: 100%')
    // A long line widens the whole surface rather than one side's own viewport.
    expect(declarations('.sideLine')).toContain('width: max-content')
  })
})
