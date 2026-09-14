/** Localized chrome for the diff surface a change preview draws. */
import type { DiffBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

type T = TranslateNS<'sidebarDocumentPreview'>

/**
 * Build the diff surface's chrome labels from this package's dictionary.
 * @param t - document-preview locale seat.
 * @returns the labels the diff primitive draws.
 */
export function diffBlockLabels(t: T): DiffBlockLabels {
  return {
    copy: t('diff.copy'),
    copied: t('diff.copied'),
    collapseAria: t('diff.collapseAria'),
    expandAria: count => t('diff.expandAria', { count }),
    collapse: t('diff.collapse'),
    expand: count => t('diff.expandRest', { count }),
    files: count => t(count === 1 ? 'diff.files.one' : 'diff.files.other', { count }),
  }
}
