import { useCallback, useEffect, useState } from 'react'
import type {
  ProjectBoardWire,
  ProjectListWire,
  ProjectSummaryWire,
  ProjectTaskWire,
  TaskStatus,
} from '@deepseek-ai/dsh-api-project/types'
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, type ProjectLocaleKey } from './locales.ts'
import css from './ProjectPanel.module.css'

/** Registration-side Remote face used by the panel. */
export interface ProjectPanelInjected {
  /** Read the stored projects with their task counts. */
  list: () => Promise<ProjectListWire>
  /** Read one project's board. */
  board: (id: string) => Promise<ProjectBoardWire>
}

/** Full component props assembled by the main-slot renderer. */
export type ProjectPanelProps =
  PropsRuntime<'main'>
  & PropsLocale<typeof NS>
  & InjectFace<ProjectPanelInjected>

type ListingState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly listing: ProjectListWire }

type BoardView =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly board: ProjectBoardWire }

/** Status lanes in the order the board reads them. */
const LANES: readonly TaskStatus[] = ['todo', 'doing', 'blocked', 'done', 'cancelled']

/** Localized lane heading per wire status. */
const LANE_KEYS = {
  todo: 'status.todo',
  doing: 'status.doing',
  blocked: 'status.blocked',
  done: 'status.done',
  cancelled: 'status.cancelled',
} satisfies Record<TaskStatus, ProjectLocaleKey>

/** Localized project-status word. */
function projectStatusKey(status: ProjectSummaryWire['status']): ProjectLocaleKey {
  return status === 'active' ? 'projectStatus.active' : 'projectStatus.closed'
}

/** One task row: its title plus the dependency and session counts it carries. */
function TaskRow({ task, t }: { task: ProjectTaskWire; t: ProjectPanelProps['t'] }) {
  return (
    <li className={css.task}>
      <span className={css.taskTitle}>{task.title}</span>
      <span className={css.taskMeta}>
        <span>{t('board.blockedBy', { count: task.blockedBy.length })}</span>
        <span>{t('board.sessions', { count: task.sessionIds.length })}</span>
      </span>
    </li>
  )
}

/**
 * Global panel over `ctx.remote.project`: the stored projects, and the board of
 * the one the reader opens. The panel owns only its own read state, so nothing
 * here outlives the panel and no store is declared.
 * @param props - the main-slot renderer's derived shares plus the Remote face.
 * @returns the project panel, its loading state, or the failed-read notice.
 */
export function ProjectPanel(props: ProjectPanelProps) {
  const { t, list, board } = props
  const [listing, setListing] = useState<ListingState>({ status: 'loading' })
  const [view, setView] = useState<BoardView>({ status: 'idle' })
  const [pending, setPending] = useState(false)

  const reload = useCallback(() => {
    setPending(true)
    setView({ status: 'idle' })
    void list().then(
      (loaded: ProjectListWire) => {
        setListing({ status: 'ready', listing: loaded })
        setPending(false)
      },
      () => {
        setListing({ status: 'error' })
        setPending(false)
      },
    )
  }, [list])

  useEffect(() => {
    reload()
  }, [reload])

  const open = useCallback((id: string) => {
    setView({ status: 'loading' })
    void board(id).then(
      (loaded: ProjectBoardWire) => { setView({ status: 'ready', board: loaded }) },
      () => { setView({ status: 'error' }) },
    )
  }, [board])

  if (listing.status === 'loading') {
    return (
      <section className={css.panel} aria-label={t('title')}>
        <p className={css.notice} role="status">{t('loading')}</p>
      </section>
    )
  }

  if (listing.status === 'error') {
    return (
      <section className={css.panel} aria-label={t('title')}>
        <p className={css.error} role="alert">{t('failed')}</p>
        <div>
          <Button size="sm" variant="outline" icon={<IconRefreshOutline16 />} onClick={reload}>
            {t('refresh')}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className={css.panel} aria-label={t('title')}>
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

      <h3 className={css.heading}>{t('projects.heading')}</h3>
      {listing.listing.projects.length === 0
        ? <p className={css.notice}>{t('projects.empty')}</p>
        : (
          <ul className={css.projects}>
            {listing.listing.projects.map(project => (
              <li key={project.id} className={css.project}>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={view.status === 'ready' && view.board.project.id === project.id}
                  onClick={() => { open(project.id) }}
                >
                  {project.title}
                </Button>
                <span className={css.projectStatus}>{t(projectStatusKey(project.status))}</span>
                <span className={css.projectMeta}>
                  <span>{t('projects.tasks', { count: project.tasks })}</span>
                  <span>{t('projects.ready', { count: project.ready })}</span>
                  <span>{t('projects.stranded', { count: project.stranded })}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      {listing.listing.truncated && <p className={css.notice}>{t('projects.truncated')}</p>}

      <h3 className={css.heading}>{t('board.heading')}</h3>
      {view.status === 'idle' && <p className={css.notice}>{t('board.hint')}</p>}
      {view.status === 'loading' && <p className={css.notice} role="status">{t('board.loading')}</p>}
      {view.status === 'error' && <p className={css.error} role="alert">{t('board.failed')}</p>}
      {view.status === 'ready' && (
        <>
          <p className={css.boardTitle}>{view.board.project.title}</p>
          {view.board.project.tasks.length === 0
            ? <p className={css.notice}>{t('board.empty')}</p>
            : (
              <div className={css.lanes}>
                {LANES.map(status => (
                  <div key={status} className={css.lane}>
                    <h4 className={css.laneHeading}>{t(LANE_KEYS[status])}</h4>
                    <ul className={css.tasks}>
                      {view.board.columns[status].map(task => <TaskRow key={task.id} task={task} t={t} />)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          {view.board.ready.length > 0 && (
            <p className={css.notice}>
              {t('board.ready', { titles: view.board.ready.join(', ') })}
            </p>
          )}
          {view.board.stranded.length > 0 && (
            <p className={css.error}>
              {t('board.stranded', { titles: view.board.stranded.join(', ') })}
            </p>
          )}
        </>
      )}
    </section>
  )
}
