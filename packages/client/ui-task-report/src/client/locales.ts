/**
 * Task-report card copy. The Chinese dictionary is the key-set source of
 * truth; the English dictionary is checked key-identical at the registration
 * site.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'

/** Dictionary namespace owned by this plugin. */
export const NS = 'taskReport'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'row.title': '任务报告',
  'row.files': '{count} 个文件',
  'row.lines': '+{added} / -{removed}',
  'row.passed': '{count} 项通过',
  'row.failed': '{count} 项失败',
  'row.unknown': '{count} 项结果未知',
  'row.open': '打开报告',
  'row.notWritten': '未写入：{reason}',
} as const

/** Key domain of the `taskReport` namespace (zh is the source of truth). */
export type TaskReportKey = keyof typeof zh

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<TaskReportKey, string> = {
  'row.title': 'Task report',
  'row.files': '{count} files',
  'row.lines': '+{added} / -{removed}',
  'row.passed': '{count} passed',
  'row.failed': '{count} failed',
  'row.unknown': '{count} unknown',
  'row.open': 'Open report',
  'row.notWritten': 'Not written: {reason}',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Task-report card copy. */
    'taskReport': TaskReportKey
  }
}

/** Namespace-addressed translate function this surface renders with. */
export type TaskReportTranslate = TranslateNS<'taskReport'>
