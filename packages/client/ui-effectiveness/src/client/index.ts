/** Outcome-signal global panel over the generated `effectiveness` Remote namespace. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: declares the `main` keyed slot this plugin occupies.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: declares the `sidebar.panellist` row this plugin occupies.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: loads the generated `effectiveness` namespace declaration onto `ctx.remote`.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { EffectivenessPanel, type EffectivenessPanelInjected } from './EffectivenessPanel.tsx'
import { EffectivenessPanelIcon } from './EffectivenessPanelIcon.tsx'
import { en, NS, zh, type EffectivenessLocaleKey } from './locales.ts'

export type { EffectivenessPanelInjected, EffectivenessPanelProps } from './EffectivenessPanel.tsx'
export type { EffectivenessLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Outcome-signal panel copy. */
    effectiveness: EffectivenessLocaleKey
  }
}

/** Services required by the panel registrations and the generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.effectiveness']

/** Main-panel key shared by the sidebar row and the centre-column occupant. */
const PANEL_ID = 'effectiveness' as MainPanelId

/**
 * Client plugin body: register the dictionaries, the global panel, and its
 * sidebar row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-effectiveness: dictionaries')

  const t = ctx.locale.bind(NS)
  const query: EffectivenessPanelInjected['query'] = async () => {
    const result = await ctx.remote.effectiveness.query(undefined)
    if (!result.ok) {
      throw new Error(`effectiveness.query failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({ query }),
  }, EffectivenessPanel))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 30,
    label: () => t('nav'),
  }, EffectivenessPanelIcon))
}
