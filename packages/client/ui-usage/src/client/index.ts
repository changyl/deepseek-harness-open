/** Token-usage Settings section over the generated `usage` Remote namespace. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: loads the generated `usage` namespace declaration onto `ctx.remote`.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { UsageSection, type UsageSectionInjected } from './UsageSection.tsx'
import { en, NS, zh, type UsageLocaleKey } from './locales.ts'

export type { UsageSectionInjected, UsageSectionProps } from './UsageSection.tsx'
export type { UsageLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Token-usage section copy. */
    'settings.usage': UsageLocaleKey
  }
}

/** Services required by the Settings registration and the generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.usage']

/**
 * Client plugin body: register the dictionaries and the usage page, ordered
 * after the composition sections that shape a deployment.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-usage: dictionaries')

  const t = ctx.locale.bind(NS)
  const query: UsageSectionInjected['query'] = async () => {
    const result = await ctx.remote.usage.query(undefined)
    if (!result.ok) {
      throw new Error(`usage.query failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ query }),
  }, UsageSection))
}
