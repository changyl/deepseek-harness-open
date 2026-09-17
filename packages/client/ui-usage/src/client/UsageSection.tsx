import { useCallback, useEffect, useState } from 'react'
import type { UsageReportWire, UsageRouteTotalsWire } from '@deepseek-ai/dsh-api-usage/types'
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './UsageSection.module.css'

/** Registration-side Remote face used by the section. */
export interface UsageSectionInjected {
  /** Read the current usage report for the whole corpus. */
  query: () => Promise<UsageReportWire>
}

/** Full component props assembled by the Settings slot renderer. */
export type UsageSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS>
  & InjectFace<UsageSectionInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly report: UsageReportWire }

/** Route identity as both the wire and the rendered row spell it. */
function routeLabel(route: Pick<UsageRouteTotalsWire, 'provider' | 'model'>): string {
  return `${route.provider}/${route.model}`
}

/**
 * Integer micro-units as a decimal amount. Six fraction digits are the full
 * resolution of the table's unit, and trailing zeros stay implicit so a whole
 * amount reads as one.
 */
function formatMicros(micros: number): string {
  const units = Math.trunc(micros / 1_000_000)
  const fraction = String(micros % 1_000_000).padStart(6, '0').replace(/0+$/u, '')
  return fraction === '' ? String(units) : `${units}.${fraction}`
}

/**
 * Settings section over `ctx.remote.usage`: one report per read, refreshed on
 * request. The section owns only its own load state, so nothing here outlives
 * the panel and no store is declared.
 * @param props - the Settings slot renderer's derived shares plus the Remote face.
 * @returns the usage panel, its loading state, or the failed-read notice.
 */
export function UsageSection(props: UsageSectionProps) {
  const { t, query } = props
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [pending, setPending] = useState(false)

  const reload = useCallback(() => {
    setPending(true)
    void query().then(
      (report: UsageReportWire) => {
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
        <div className={css.total}>
          <dt>{t('totals.sessions')}</dt>
          <dd>{report.totals.sessions}</dd>
        </div>
        <div className={css.total}>
          <dt>{t('totals.turns')}</dt>
          <dd>{report.totals.turns}</dd>
        </div>
        <div className={css.total}>
          <dt>{t('totals.steps')}</dt>
          <dd>{report.totals.steps}</dd>
        </div>
        <div className={css.total}>
          <dt>{t('totals.unknownSteps')}</dt>
          <dd>{report.totals.unknownUsageSteps}</dd>
        </div>
        <div className={css.total}>
          <dt>{t('tokens.uncachedInput')}</dt>
          <dd>{report.totals.uncachedInputTokens}</dd>
        </div>
        <div className={css.total}>
          <dt>{t('tokens.output')}</dt>
          <dd>{report.totals.outputTokens}</dd>
        </div>
        <div className={css.total}>
          <dt>{t('tokens.cacheRead')}</dt>
          <dd>{report.totals.cacheReadTokens}</dd>
        </div>
        <div className={css.total}>
          <dt>{t('tokens.cacheWrite')}</dt>
          <dd>{report.totals.cacheWriteTokens}</dd>
        </div>
      </dl>

      <h3 className={css.heading}>{t('routes.heading')}</h3>
      {report.routes.length === 0
        ? <p className={css.notice}>{t('routes.empty')}</p>
        : (
          <table className={css.table}>
            <thead>
              <tr>
                <th scope="col">{t('routes.route')}</th>
                <th scope="col">{t('routes.sessions')}</th>
                <th scope="col">{t('routes.steps')}</th>
                <th scope="col">{t('tokens.uncachedInput')}</th>
                <th scope="col">{t('tokens.output')}</th>
                <th scope="col">{t('tokens.cacheRead')}</th>
                <th scope="col">{t('tokens.cacheWrite')}</th>
              </tr>
            </thead>
            <tbody>
              {report.routes.map(route => (
                <tr key={routeLabel(route)}>
                  <th scope="row">{routeLabel(route)}</th>
                  <td>{route.sessions}</td>
                  <td>{route.steps}</td>
                  <td>{route.uncachedInputTokens}</td>
                  <td>{route.outputTokens}</td>
                  <td>{route.cacheReadTokens}</td>
                  <td>{route.cacheWriteTokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <h3 className={css.heading}>{t('cost.heading')}</h3>
      {report.cost === undefined
        ? <p className={css.notice}>{t('cost.none')}</p>
        : (
          <div className={css.cost}>
            <p className={css.amount}>
              {t('cost.amount', { amount: formatMicros(report.cost.totalMicros), currency: report.cost.currency })}
            </p>
            <p className={css.notice}>{t('cost.version', { version: report.cost.pricingVersion })}</p>
            {!report.cost.complete && <p className={css.error}>{t('cost.incomplete')}</p>}
          </div>
        )}

      {report.unpriced.length > 0 && (
        <>
          <h3 className={css.heading}>{t('unpriced.heading')}</h3>
          <ul className={css.unpriced}>
            {report.unpriced.map(route => <li key={routeLabel(route)}>{routeLabel(route)}</li>)}
          </ul>
        </>
      )}
    </section>
  )
}
