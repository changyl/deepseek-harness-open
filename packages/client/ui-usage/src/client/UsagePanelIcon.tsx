import { IconGaugeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Sidebar row glyph for the usage global panel.
 * @param props - the panellist row's requested glyph size.
 * @returns the usage glyph at that size.
 */
export function UsagePanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconGaugeOutline16 size={size} />
}
