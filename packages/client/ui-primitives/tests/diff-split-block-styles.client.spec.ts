/**
 * DiffSplitBlock's shared column axis as CSS text. jsdom has no layout, so the
 * component suite cannot see the defect these rules prevent: with a grid per
 * band, each band sizes its two columns from its own lines, so the divider
 * between the old and new sides sits at a different x on every row and a long
 * new line starts inside the old side's range. The body must own the grid and
 * every band must contribute its cells to it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/DiffSplitBlock.module.css', import.meta.url)), 'utf8')
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\/]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`DiffSplitBlock.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('DiffSplitBlock.module.css shared columns', () => {
  it('sizes both columns once on the scroll body', () => {
    expect(declarations('.body')).toEqual(expect.arrayContaining([
      'display: grid',
      'grid-template-columns: minmax(min-content, 1fr) minmax(min-content, 1fr)',
      'overflow-x: auto',
    ]))
  })

  it('makes a band a transparent grid contributor instead of its own grid', () => {
    expect(declarations('.row')).toContain('display: contents')
    expect(declarations('.row').some(declaration => declaration.startsWith('grid-template-columns'))).toBe(false)
  })

  it('spans the full-width bands over both columns', () => {
    for (const selector of ['.path', '.gap', '.expand']) {
      expect(declarations(selector)).toEqual(expect.arrayContaining(['display: block', 'grid-column: 1 / -1']))
    }
  })
})
