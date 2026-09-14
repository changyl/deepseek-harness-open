/** The diff surface's chrome labels come from this package's own dictionary. */
import { expect, it } from 'vitest'
import { diffBlockLabels } from '../src/client/diff-labels.ts'

/** Key-echoing seat that shows the parameters, so a label proves which key it read. */
const t = ((key: string, params?: Record<string, unknown>): string =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as unknown as Parameters<typeof diffBlockLabels>[0]

it('builds every diff label, including the counted ones', () => {
  const labels = diffBlockLabels(t)
  expect(labels.copy).toBe('diff.copy')
  expect(labels.copied).toBe('diff.copied')
  expect(labels.collapseAria).toBe('diff.collapseAria')
  expect(labels.collapse).toBe('diff.collapse')
  expect(labels.expandAria(3)).toBe('diff.expandAria:{"count":3}')
  expect(labels.expand(4)).toBe('diff.expandRest:{"count":4}')
  // One file reads as the singular label, any other count as the plural.
  expect(labels.files(1)).toBe('diff.files.one:{"count":1}')
  expect(labels.files(2)).toBe('diff.files.other:{"count":2}')
})
