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
    // The shared toolbar names the language it cannot highlight and the two
    // wrapping actions; this namespace already owns that copy for the preview.
    codeLabel: t('viewer.text'),
    wrapLabel: t('wrap.enable'),
    unwrapLabel: t('wrap.disable'),
    copy: t('diff.copy'),
    copied: t('diff.copied'),
    collapseAria: t('diff.collapseAria'),
    expandAria: count => t('diff.expandAria', { count }),
    collapse: t('diff.collapse'),
    expand: count => t('diff.expandRest', { count }),
  }
}
