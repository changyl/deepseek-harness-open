/** Outcome-signal Settings section over the generated `effectiveness` Remote namespace. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: loads the generated `effectiveness` namespace declaration onto `ctx.remote`.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { EffectivenessSection, type EffectivenessSectionInjected } from './EffectivenessSection.tsx'
import { en, NS, zh, type EffectivenessLocaleKey } from './locales.ts'

export type { EffectivenessSectionInjected, EffectivenessSectionProps } from './EffectivenessSection.tsx'
export type { EffectivenessLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Outcome-signal section copy. */
    'settings.effectiveness': EffectivenessLocaleKey
  }
}

/** Services required by the Settings registration and the generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.effectiveness']

/**
 * Client plugin body: register the dictionaries and the outcome-signal page,
 * ordered last among the read-only deployment panels.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-effectiveness: dictionaries')

  const t = ctx.locale.bind(NS)
  const query: EffectivenessSectionInjected['query'] = async () => {
    const result = await ctx.remote.effectiveness.query(undefined)
    if (!result.ok) {
      throw new Error(`effectiveness.query failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'effectiveness',
    order: 50,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ query }),
  }, EffectivenessSection))
}
