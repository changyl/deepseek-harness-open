import { useCallback, useEffect, useState } from 'react'
import type {
  EffectivenessReportWire,
  EffectivenessRouteRowWire,
  EffectivenessSessionRowWire,
  FeedbackCategoryWire,
} from '@deepseek-ai/dsh-api-effectiveness/types'
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, type EffectivenessLocaleKey } from './locales.ts'
import css from './EffectivenessSection.module.css'

/** Registration-side Remote face used by the section. */
export interface EffectivenessSectionInjected {
  /** Read the current outcome-signal report for the whole corpus. */
  query: () => Promise<EffectivenessReportWire>
}

/** Full component props assembled by the Settings slot renderer. */
export type EffectivenessSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS>
  & InjectFace<EffectivenessSectionInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly report: EffectivenessReportWire }

/** Every category the wire declares, in the order a reader scans them. */
const CATEGORIES: readonly FeedbackCategoryWire[] = ['task-result', 'instruction-following', 'product-interaction']

/** Localized category name per wire category. */
const CATEGORY_KEYS = {
  'task-result': 'category.task-result',
  'instruction-following': 'category.instruction-following',
  'product-interaction': 'category.product-interaction',
} satisfies Record<FeedbackCategoryWire, EffectivenessLocaleKey>

/** Route identity as both the wire and the rendered row spell it. */
function routeLabel(route: Pick<EffectivenessRouteRowWire, 'provider' | 'model'>): string {
  return `${route.provider}/${route.model}`
}

/** Session creation time as a stable UTC date; the exact clock time is noise here. */
function createdDate(session: EffectivenessSessionRowWire): string {
  return new Date(session.createdAt).toISOString().slice(0, 10)
}

/**
 * Settings section over `ctx.remote.effectiveness`: one report per read,
 * refreshed on request. The section owns only its own load state, so nothing
 * here outlives the panel and no store is declared.
 * @param props - the Settings slot renderer's derived shares plus the Remote face.
 * @returns the outcome-signal panel, its loading state, or the failed-read notice.
 */
export function EffectivenessSection(props: EffectivenessSectionProps) {
  const { t, query } = props
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [pending, setPending] = useState(false)

  const reload = useCallback(() => {
    setPending(true)
    void query().then(
      (report: EffectivenessReportWire) => {
        setState({ status: 'ready', report })
        setPending(false)
      },
      () => {
        setState({ status: 'error' })
        setPending(false)
      },
    )
  }, [query])

  useEffect(() => {
    reload()
  }, [reload])

  if (state.status === 'loading') {
    return <p className={css.notice} role="status">{t('loading')}</p>
  }

  if (state.status === 'error') {
    return (
      <section className={css.section} aria-label={t('title')}>
        <p className={css.error} role="alert">{t('failed')}</p>
        <div>
          <Button size="sm" variant="outline" icon={<IconRefreshOutline16 />} onClick={reload}>
            {t('refresh')}
          </Button>
        </div>
      </section>
    )
  }

  const { report } = state
  const categories = CATEGORIES.flatMap((category) => {
    const count = report.totals.feedback.byCategory[category]
    return count === undefined ? [] : [[category, count] as const]
  })

  return (
    <section className={css.section} aria-label={t('title')}>
      <header className={css.header}>
        <h2 className={css.title}>{t('title')}</h2>
        <Button
          size="sm"
          variant="outline"
          icon={<IconRefreshOutline16 />}
          disabled={pending}
          onClick={reload}
        >
          {t('refresh')}
        </Button>
      </header>
      <p className={css.intro}>{t('intro')}</p>

      <h3 className={css.heading}>{t('totals.heading')}</h3>
      <dl className={css.totals}>
        <div className={css.total}><dt>{t('totals.sessions')}</dt><dd>{report.totals.sessions}</dd></div>
        <div className={css.total}><dt>{t('totals.turns')}</dt><dd>{report.totals.turnsWithSignal}</dd></div>
        <div className={css.total}><dt>{t('feedback.positive')}</dt><dd>{report.totals.feedback.positive}</dd></div>
        <div className={css.total}><dt>{t('feedback.negative')}</dt><dd>{report.totals.feedback.negative}</dd></div>
        <div className={css.total}><dt>{t('changes.accepted')}</dt><dd>{report.totals.changes.accepted}</dd></div>
        <div className={css.total}><dt>{t('changes.reverted')}</dt><dd>{report.totals.changes.reverted}</dd></div>
        <div className={css.total}><dt>{t('changes.undecided')}</dt><dd>{report.totals.changes.undecided}</dd></div>
        <div className={css.total}><dt>{t('verification.passed')}</dt><dd>{report.totals.verification.passed}</dd></div>
        <div className={css.total}><dt>{t('verification.failed')}</dt><dd>{report.totals.verification.failed}</dd></div>
        <div className={css.total}><dt>{t('verification.unknown')}</dt><dd>{report.totals.verification.unknown}</dd></div>
      </dl>
      {report.totals.sessions === 0 && <p className={css.notice}>{t('signal.none')}</p>}

      {categories.length > 0 && (
        <>
          <h3 className={css.heading}>{t('feedback.categories')}</h3>
          <ul className={css.categories}>
            {categories.map(([category, count]) => (
              <li key={category}>{`${t(CATEGORY_KEYS[category])}: ${String(count)}`}</li>
            ))}
          </ul>
        </>
      )}

      <h3 className={css.heading}>{t('routes.heading')}</h3>
      {report.routes.length === 0
        ? <p className={css.notice}>{t('routes.empty')}</p>
        : (
          <table className={css.table}>
            <thead>
              <tr>
                <th scope="col">{t('routes.route')}</th>
                <th scope="col">{t('routes.sessions')}</th>
                <th scope="col">{t('totals.turns')}</th>
                <th scope="col">{t('feedback.positive')}</th>
                <th scope="col">{t('feedback.negative')}</th>
                <th scope="col">{t('verification.passed')}</th>
                <th scope="col">{t('verification.failed')}</th>
              </tr>
            </thead>
            <tbody>
              {report.routes.map(route => (
                <tr key={routeLabel(route)}>
                  <th scope="row">{routeLabel(route)}</th>
                  <td>{route.sessions}</td>
                  <td>{route.turnsWithSignal}</td>
                  <td>{route.feedback.positive}</td>
                  <td>{route.feedback.negative}</td>
                  <td>{route.verification.passed}</td>
                  <td>{route.verification.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <h3 className={css.heading}>{t('sessions.heading')}</h3>
      {report.sessions.length === 0
        ? <p className={css.notice}>{t('sessions.empty')}</p>
        : (
          <ul className={css.sessions}>
            {report.sessions.map(session => (
              <li key={session.sessionId} className={css.session}>
                <span className={css.sessionId}>{session.sessionId}</span>
                <span className={css.sessionMeta}>
                  <span>{t('sessions.createdAt', { time: createdDate(session) })}</span>
                  <span>{`${t('sessions.turns')}: ${String(session.turnsWithSignal)}`}</span>
                  <span>{session.routes.map(routeLabel).join(', ')}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      {report.truncated && <p className={css.notice}>{t('sessions.truncated')}</p>}
    </section>
  )
}
