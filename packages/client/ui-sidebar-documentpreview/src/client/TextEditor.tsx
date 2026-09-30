/**
 * The file editor: one editable text surface over the draft the owner holds,
 * drawn in the edited file's own grammar.
 *
 * A `<textarea>` keeps the whole editing contract — the value, the caret, the
 * selection, native undo, and IME — with no second document model to keep in
 * sync with the store. Grammar colour comes from a layer drawn behind it, which
 * the textarea shows its own transparent text through. The layer is drawn only
 * while it matches the draft exactly: a reader typing sees the textarea's plain
 * text, and the colours of a pause arrive from a tokenization of the draft as
 * it then stood, so the surface never shows glyphs the reader has changed.
 *
 * Tokenizing a draft costs about half a millisecond a source line in the shared
 * highlighter, which is synchronous, so the shared `useHighlightedCode` pass
 * tokenizes a bounded number of lines per turn of the event loop and yields
 * between them: a long file colours without any single pause the reader would
 * feel. A draft past that hook's line budget, or one whose language has no
 * grammar, is edited as plain text — colour is an upgrade over an editable
 * surface that never depends on it.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef } from 'react'
import type { ReactNode, UIEvent } from 'react'
import { useHighlightedCode } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './TextEditor.module.css'

/** The editor's inputs: the draft, how to change it, how to draw it, and the panes that follow it. */
export interface TextEditorProps {
  /** The draft's current text. */
  readonly value: string
  /**
   * Take the reader's latest keystrokes.
   * @param text - the textarea's value after the edit.
   */
  readonly onChange: (text: string) => void
  /** Whether long lines wrap; the tab's own wrap preference, so one control drives both views. */
  readonly wrap: boolean
  /** Localized accessible name for the editing surface. */
  readonly label: string
  /** Grammar hint for the edited file; an unsupported or absent one draws plain text. */
  readonly lang: string | undefined
  /**
   * Bind the scrolling surface, so the owner can move it.
   * @param surface - the textarea, or null when the editor unmounts.
   */
  readonly scrollRef: (surface: HTMLTextAreaElement | null) => void
  /**
   * Take every scroll of the editing surface, so the owner can keep another pane in step.
   * @param surface - the scrolled textarea.
   */
  readonly onScroll: (surface: HTMLTextAreaElement) => void
}

/**
 * Draw one editing surface for the file being edited.
 * @param props - draft, change handler, wrap preference, grammar hint, accessible name, and the pane bindings.
 * @returns the editor.
 */
export function TextEditor({ value, onChange, wrap, label, lang, scrollRef, onScroll }: TextEditorProps): ReactNode {
  const surfaceRef = useRef<HTMLTextAreaElement | null>(null)
  const highlightRef = useRef<HTMLPreElement | null>(null)
  /** Where the surface sits, so a layer arriving later opens at the same place. */
  const offsetsRef = useRef<{ top: number; left: number }>({ top: 0, left: 0 })
  // The shared pass tokenizes the draft once the reader stops typing, a bounded
  // number of lines per turn of the event loop. Every keystroke restarts the
  // wait, and the layer stays away until the runs describe the draft on screen.
  const lines = useHighlightedCode(useMemo(() => [value], [value]), lang)[0]
  // Entering the editor is an explicit act, so the caret belongs in it; the
  // session's mount is the only moment that is true, not every render.
  useEffect(() => {
    surfaceRef.current?.focus()
  }, [])
  const bindSurface = useCallback((element: HTMLTextAreaElement | null): void => {
    surfaceRef.current = element
    scrollRef(element)
  }, [scrollRef])
  const bindHighlight = useCallback((element: HTMLPreElement | null): void => {
    highlightRef.current = element
    if (element === null) return
    // A layer drawn under a surface the reader already scrolled opens there.
    element.scrollTop = offsetsRef.current.top
    element.scrollLeft = offsetsRef.current.left
  }, [])
  const onSurfaceScroll = (event: UIEvent<HTMLTextAreaElement>): void => {
    const surface = event.currentTarget
    offsetsRef.current.top = surface.scrollTop
    offsetsRef.current.left = surface.scrollLeft
    const highlight = highlightRef.current
    if (highlight !== null) {
      highlight.scrollTop = surface.scrollTop
      highlight.scrollLeft = surface.scrollLeft
    }
    onScroll(surface)
  }
  return (
    <div className={css.editor} data-textpreview-editor data-textpreview-wrap={wrap ? '' : undefined}>
      {lines !== undefined && (
        // The same text as the textarea, for its colour alone: it is hidden
        // from assistive technology, which reads the textarea.
        <pre
          ref={bindHighlight}
          className={css.highlight}
          aria-hidden="true"
          data-textpreview-highlight
        >
          {lines.map((line, index) => (
            <Fragment key={index}>
              {index > 0 && '\n'}
              <span>{line.map((span, at) => <span key={at} style={span.style}>{span.text}</span>)}</span>
            </Fragment>
          ))}
        </pre>
      )}
      <textarea
        ref={bindSurface}
        className={css.surface}
        value={value}
        onChange={(event) => { onChange(event.target.value) }}
        onScroll={onSurfaceScroll}
        aria-label={label}
        wrap={wrap ? 'soft' : 'off'}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
      />
    </div>
  )
}
