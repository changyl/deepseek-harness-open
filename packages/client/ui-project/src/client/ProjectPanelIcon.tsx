import { IconProjectAddOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Sidebar row glyph for the project-board global panel.
 * @param props - the panellist row's requested glyph size.
 * @returns the project glyph at that size.
 */
export function ProjectPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconProjectAddOutline16 size={size} />
}
