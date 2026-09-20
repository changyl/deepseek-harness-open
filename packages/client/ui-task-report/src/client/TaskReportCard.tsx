/**
 * Task-report card: the closing turn's change summary and verification result,
 * rendered in the turn tail beside the assistant action row. Pure presentation:
 * every fact arrives through the Turn owner currency, the report reader, and the
 * locale seat; a Turn without a report renders nothing.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Button, IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TaskReportEventData } from '@deepseek-ai/dsh-task-report/types'
import { selectTaskReport } from './turn-report.ts'
import { NS, type TaskReportTranslate } from './locales.ts'
import css from './TaskReportCard.module.css'

/** Props of the turn-tail card: the Turn owner currency plus the locale seat. */
export type TaskReportCardProps = PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<typeof NS>

/**
 * Render one turn's task report row.
 * @param props - Turn owner currency and the localized copy seat.
 * @returns the report row, or nothing when the Turn has no report.
 */
export function TaskReportCard({ turn, seq, openFile, t }: TaskReportCardProps): ReactNode {
  const report = selectTaskReport({ turn, seq, openFile })?.report
  const facts = useMemo(() => report === undefined ? [] : factList(report, t), [report, t])
  if (report === undefined) return null
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
            onClick={() => { openFile(path) }}
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
