/** Project-board Settings section over the generated `project` Remote namespace. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: loads the generated `project` namespace declaration onto `ctx.remote`.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ProjectSection, type ProjectSectionInjected } from './ProjectSection.tsx'
import { en, NS, zh, type ProjectLocaleKey } from './locales.ts'

export type { ProjectSectionInjected, ProjectSectionProps } from './ProjectSection.tsx'
export type { ProjectLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Project-board section copy. */
    'settings.projects': ProjectLocaleKey
  }
}

/** Services required by the Settings registration and the generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.project']

/**
 * Client plugin body: register the dictionaries and the project page, ordered
 * after the read-only deployment panels.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-project: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: ProjectSectionInjected['list'] = async () => {
    const result = await ctx.remote.project.list(undefined)
    if (!result.ok) {
      throw new Error(`project.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const board: ProjectSectionInjected['board'] = async (id) => {
    const result = await ctx.remote.project.board(id)
    if (!result.ok) {
      throw new Error(`project.board failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'projects',
    order: 40,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ list, board }),
  }, ProjectSection))
}
