/**
 * Command-palette overlay: the `shell.overlay` entry that renders the
 * controller's state as one centered search card. The card holds focus while
 * open — the search input takes it on open, plain typing filters the loaded
 * rows, Arrow keys move a virtual highlight scrolled into view, Enter runs the
 * highlighted row, and Escape or the mask closes through the shared `Modal`
 * shell. Closed state renders nothing; the overlay entry stays mounted.
 */
import { Fragment, useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import clsx from 'clsx'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { IconCodeOutline16, IconNewChatOutline16, IconSearchOutline16, IconStopFill16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { filterEntries, type PaletteEntryKind, type PaletteState } from './palette.ts'
import css from './CommandPalette.module.css'

/** Injected business face of the palette overlay entry. */
export interface CommandPaletteInjected {
  hooks: {
    /** The controller's open/load/query state. */
    palette: ObservableSnapshot<PaletteState>
  }
  /** Close without running anything. */
  close(): void
  /** Replace the filter text. */
  setQuery(text: string): void
  /** Move the highlight by `delta` visible rows. */
  move(delta: number): void
  /** Highlight one visible row (pointer hover). */
  highlight(index: number): void
  /** Run the row behind one entry id. */
  run(id: string): void
  /** Reload the rows after a failed load. */
  retry(): void
}

/** Composed props: the root-scope runtime share, the locale seat, and this entry's inject face. */
export type CommandPaletteProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'commandPalette'>
  & InjectFace<CommandPaletteInjected>

/** Row glyph for one entry kind (the palette owns no per-command icon). */
function EntryGlyph({ kind }: { kind: PaletteEntryKind }): ReactNode {
  switch (kind) {
    case 'new-session':
      return <IconNewChatOutline16 size={14} />
    case 'stop':
      return <IconStopFill16 size={14} />
    case 'command':
      return <IconCodeOutline16 size={14} />
  }
}

/** Listbox id the search input controls. */
const LIST_ID = 'command-palette-list'

/**
 * Option id for one visible row.
 * @param index - index within the visible rows.
 * @returns the DOM id of that option.
 */
function optionId(index: number): string {
  return `command-palette-option-${index}`
}

/**
 * Render the command palette.
 * @param props - inject face (state hook and verbs) and the locale `t` seat.
 * @returns the search card while open; null while closed.
 */
export function CommandPalette({
  usePalette, close, setQuery, move, highlight, run, retry, t,
}: CommandPaletteProps): ReactNode {
  const state = usePalette(snapshot => snapshot)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rows = filterEntries(state.entries, state.query)
  const active = rows[state.active]
  const activeId = active === undefined ? undefined : optionId(state.active)

  // Focus ownership: the search input grabs on open. The card never restores
  // composer focus on close, because the composer is not this surface's: the
  // command surface hands the caret back after a pick through its own
  // per-session hook, and the two actions this surface owns ask it to.
  useEffect(() => {
    if (state.open) searchRef.current?.focus()
  }, [state.open])

  // Arrow keys move a virtual highlight, so the browser never scrolls the
  // active row into view — do it here.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [state.active, state.query, state.entries])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        return
      case 'Enter':
        if (active === undefined) return
        event.preventDefault()
        run(active.id)
        return
      default:
    }
  }

  return (
    <Modal open={state.open} onClose={close} title={t('palette.aria')} headless className={css.dialog as string}>
      <div className={css.card} onKeyDown={onKeyDown}>
        <div className={css.searchRow}>
          <IconSearchOutline16 size={14} className={css.searchIcon} />
          <input
            ref={searchRef}
            className={css.search}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={LIST_ID}
            aria-activedescendant={activeId}
            aria-label={t('palette.placeholder')}
            placeholder={t('palette.placeholder')}
            value={state.query}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
          />
        </div>
        {state.status === 'loading' && <div className={css.status}>{t('palette.status.loading')}</div>}
        {state.status === 'no-session' && <div className={css.status}>{t('palette.status.noSession')}</div>}
        {state.status === 'failed' && (
          <div className={css.error} role="alert">
            <span className={css.errorText}>{state.error ?? t('palette.status.failed')}</span>
            <button type="button" className={css.retry} onClick={retry}>{t('retry')}</button>
          </div>
        )}
        {state.status === 'ready' && rows.length === 0 && (
          <div className={css.status}>{t('palette.status.empty')}</div>
        )}
        <div ref={listRef} id={LIST_ID} role="listbox" aria-label={t('palette.listbox')} className={css.list}>
          {rows.map((entry, index) => (
            <Fragment key={entry.id}>
              {entry.section !== undefined && entry.section !== rows[index - 1]?.section && (
                <div className={css.section} role="presentation">{entry.section}</div>
              )}
              <div
                id={optionId(index)}
                role="option"
                aria-selected={index === state.active}
                className={clsx(css.row, index === state.active && css.rowActive)}
                onClick={() => { run(entry.id) }}
                onMouseEnter={() => { highlight(index) }}
              >
                <span className={css.glyph}><EntryGlyph kind={entry.kind} /></span>
                <span className={css.label}>{entry.label}</span>
                {entry.description !== undefined && <span className={css.description}>{entry.description}</span>}
                {entry.hint !== undefined && <span className={css.hint}>{entry.hint}</span>}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </Modal>
  )
}
