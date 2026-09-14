/**
 * Task-report card: the closing turn's change summary and verification result,
 * rendered in the turn tail beside the assistant action row. Pure presentation:
 * every fact arrives through the chain selector's match and the locale seat.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Button, IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TaskReportEventData } from '@deepseek-ai/dsh-task-report/types'
import type { TaskReportMatch } from './turn-report.ts'
import { NS, type TaskReportTranslate } from './locales.ts'
import css from './TaskReportCard.module.css'

/** Props of the turn-tail card: the selector's match plus the locale seat. */
export type TaskReportCardProps = { matched: TaskReportMatch } & PropsLocale<typeof NS>

/**
 * Render one turn's task report row.
 * @param props - matched report facts and the localized copy seat.
 * @returns the report row, or nothing when the report has no facts to state.
 */
export function TaskReportCard({ matched, t }: TaskReportCardProps): ReactNode {
  const { report } = matched
  const facts = useMemo(() => factList(report, t), [report, t])
  const path = report.path

  return (
    <div className={css.row}>
      <span className={css.glyph}><IconChecklistOutline14 size={14} /></span>
      <span className={css.title}>{t('row.title')}</span>
      <span className={css.facts}>{facts.join(' · ')}</span>
      {path === undefined
        ? <span className={css.failure}>{t('row.notWritten', { reason: report.error ?? '' })}</span>
        : (
          <Button
            variant="ghost"
            onClick={() => { matched.openFile(path) }}
          >
            {t('row.open')}
          </Button>
        )}
    </div>
  )
}

/**
 * The report's own facts in reading order.
 * @param report - durable report payload.
 * @param t - card translator.
 * @returns localized fragments, empty when the report has nothing to state.
 */
function factList(report: TaskReportEventData, t: TaskReportTranslate): string[] {
  const facts: string[] = []
  if (report.changes.length > 0) {
    facts.push(t('row.files', { count: report.changes.length }))
    facts.push(t('row.lines', {
      added: report.changes.reduce((total, change) => total + change.added, 0),
      removed: report.changes.reduce((total, change) => total + change.removed, 0),
    }))
  }
  const passed = report.verification.filter(entry => entry.status === 'passed').length
  const failed = report.verification.filter(entry => entry.status === 'failed').length
  const unknown = report.verification.length - passed - failed
  if (passed > 0) facts.push(t('row.passed', { count: passed }))
  if (failed > 0) facts.push(t('row.failed', { count: failed }))
  if (unknown > 0) facts.push(t('row.unknown', { count: unknown }))
  return facts
}
