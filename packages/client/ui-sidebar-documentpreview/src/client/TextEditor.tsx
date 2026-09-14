/**
 * The file editor: one plain text surface over the draft the owner holds.
 *
 * A `<textarea>` rather than an editor framework, for now: it is the whole
 * editing contract — a scrolling text surface whose value the owner keeps and
 * whose every keystroke the owner hears — with no dependency, no bundle weight,
 * and no second document model to keep in sync with the store. What it gives up
 * is syntax colouring and line numbers, which is a presentation upgrade this
 * component can absorb later without the owner or the store changing.
 *
 * It stays uncontrolled in the one way that matters: the value is written from
 * the draft, but the element is never remounted or re-keyed, so the caret,
 * selection, and native undo stack survive every render the store causes.
 */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './TextEditor.module.css'

/** The editor's inputs: the draft, how to change it, and how to draw it. */
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
}

/**
 * Draw one editing surface for the file being edited.
 * @param props - draft, change handler, wrap preference, and accessible name.
 * @returns the editor.
 */
export function TextEditor({ value, onChange, wrap, label }: TextEditorProps): ReactNode {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  // Entering the editor is an explicit act, so the caret belongs in it; the
  // session's mount is the only moment that is true, not every render.
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div className={css.editor} data-textpreview-editor>
      <textarea
        ref={ref}
        className={clsx(css.surface, wrap && css.wrap)}
        value={value}
        onChange={(event) => { onChange(event.target.value) }}
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
