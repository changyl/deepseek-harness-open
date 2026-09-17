import { IconLikeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Sidebar row glyph for the outcome-signal global panel.
 * @param props - the panellist row's requested glyph size.
 * @returns the outcome-signal glyph at that size.
 */
export function EffectivenessPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconLikeOutline16 size={size} />
}
