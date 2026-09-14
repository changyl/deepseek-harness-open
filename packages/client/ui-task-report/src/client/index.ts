/**
 * Task-report card plugin, browser half: registers the `task-report/generated`
 * fold and contributes its row to the chat view's turn-tail chain. Composing
 * this plugin out of cordis.yml removes the row entirely; the owning view then
 * renders an empty chain for every turn.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the 'conversation.chat.turnTail' SlotMap declaration (the
// key's owner) into this program — no runtime edge to ui-chat.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TaskReportCard } from './TaskReportCard.tsx'
import { en, NS, zh } from './locales.ts'
import { selectTaskReport, taskReportDefinition } from './turn-report.ts'

export type { TaskReportKey } from './locales.ts'
export type { TaskReportCardProps } from './TaskReportCard.tsx'
export type { TaskReportMatch, TaskReportTurnData } from './turn-report.ts'

/** Required services: the locale registry and the conversation registries. */
export const inject = ['slots', 'locale', 'uiConversation']

/**
 * Client plugin body: register the dictionaries, the turn-scoped fold, and the
 * turn-tail row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-task-report: dictionaries')
  ctx.uiConversation.events.register(taskReportDefinition)
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: selectTaskReport,
    locale: NS,
  }, TaskReportCard))
}
