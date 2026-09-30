/**
 * The editor's two surfaces as CSS text. jsdom lays nothing out, so the
 * component suite cannot see the defect these rules prevent: the grammar layer
 * carries the same text the textarea does, and it lands on the same glyphs only
 * while both declare identical text metrics, stay in the same box, and wrap by
 * the same rules. The layer is also out of the pointer path, so the reader's
 * caret, selection, and native drags belong to the textarea alone.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/TextEditor.module.css', import.meta.url)), 'utf8')
/** The sheet without comments and with every run of whitespace collapsed, so a selector can be named exactly as a browser reads it. */
const flat = css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ')

/** One rule of the flattened sheet: its selector, then its declarations. */
const RULE = /(?:^|(?<=\}))\s*([^{}]+)\{([^{}]*)\}/g

/**
 * One rule's declarations, matched on its whole selector so a rule sharing a
 * selector with another (`surface, .highlight`) never answers for it.
 * @param selector - the rule's selector, as the flattened sheet writes it.
 * @returns the declarations between that rule's braces.
 */
function declarations(selector: string): string {
  for (const [, found, body = ''] of flat.matchAll(RULE)) {
    if (found?.trim() === selector) return body
  }
  throw new Error(`TextEditor.module.css has no \`${selector}\` rule`)
}

describe('TextEditor.module.css overlaid surfaces', () => {
  it('gives the grammar layer and the textarea one set of text metrics', () => {
    const shared = declarations('.surface, .highlight')
    for (const declaration of [
      'box-sizing: border-box',
      'padding: 8px 12px',
      'font-family: var(--dsw-font-mono, ui-monospace, monospace)',
      'font-size: var(--dsh-content-font-size-secondary, 13px)',
      'line-height: 1.6',
      'tab-size: 2',
      'white-space: pre',
    ]) {
      expect(shared).toContain(declaration)
    }
  })

  it('clips the layer to the editing box and keeps it out of the pointer path', () => {
    const layer = declarations('.highlight')
    expect(layer).toContain('position: absolute')
    expect(layer).toContain('inset: 0')
    expect(layer).toContain('overflow: hidden')
    expect(layer).toContain('pointer-events: none')
  })

  it('keeps both surfaces clear of the width the surface scrollbar takes', () => {
    // The layer never scrolls, so it reserves the bar's width as padding while
    // the surface reserves it as a gutter; a wrapped line then breaks at the
    // same glyph on both.
    expect(declarations('.surface')).toContain('scrollbar-gutter: stable')
    expect(declarations('.highlight')).toContain('padding-right: calc(12px + var(--dsh-scrollbar-width, 8px))')
  })

  it('makes the textarea the scroller, drawing only the caret and selection over a layer', () => {
    const surface = declarations('.surface')
    expect(surface).toContain('position: absolute')
    expect(surface).toContain('inset: 0')
    expect(surface).toContain('overflow: auto')
    const overlaid = declarations('.editor:has([data-textpreview-highlight]) .surface')
    expect(overlaid).toContain('color: transparent')
    expect(overlaid).toContain('caret-color: var(--dsw-alias-label-primary)')
  })

  it('wraps both surfaces by the same rules', () => {
    const wrapped = declarations('.editor[data-textpreview-wrap] .surface, .editor[data-textpreview-wrap] .highlight')
    expect(wrapped).toContain('white-space: pre-wrap')
    expect(wrapped).toContain('word-break: break-word')
  })
})
