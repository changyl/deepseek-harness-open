/** Token-usage global panel over the generated `usage` Remote namespace. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: declares the `main` keyed slot this plugin occupies.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: declares the `sidebar.panellist` row this plugin occupies.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: loads the generated `usage` namespace declaration onto `ctx.remote`.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { UsagePanel, type UsagePanelInjected } from './UsagePanel.tsx'
import { UsagePanelIcon } from './UsagePanelIcon.tsx'
import { en, NS, zh, type UsageLocaleKey } from './locales.ts'

export type { UsagePanelInjected, UsagePanelProps } from './UsagePanel.tsx'
export type { UsageLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Token-usage panel copy. */
    usage: UsageLocaleKey
  }
}

/** Services required by the panel registrations and the generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.usage']

/** Main-panel key shared by the sidebar row and the centre-column occupant. */
const PANEL_ID = 'usage' as MainPanelId

/**
 * Client plugin body: register the dictionaries, the global panel, and its
 * sidebar row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-usage: dictionaries')

  const t = ctx.locale.bind(NS)
  const query: UsagePanelInjected['query'] = async () => {
    const result = await ctx.remote.usage.query(undefined)
    if (!result.ok) {
      throw new Error(`usage.query failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({ query }),
  }, UsagePanel))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    label: () => t('nav'),
  }, UsagePanelIcon))
}
