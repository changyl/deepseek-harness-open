/**
 * ui-task-report browser half on a real SlotRegistry: the plugin occupies the
 * chat view's turn-tail chain with its selector and registers the turn-scoped
 * fold; teardown releases both, and the inert node half contributes nothing.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TaskReportCard } from '../src/client/TaskReportCard.tsx'
import { apply, inject } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { selectTaskReport, taskReportDefinition } from '../src/client/turn-report.ts'
import { apply as applyNode } from '../src/index.ts'

/** Boot the browser half over a real slot tree that declares the turn tail. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.chat.turnTail': { kind: 'chain', scope: 'session' } },
  } as never, () => null)
  const definitions: ConversationNodeDefinition[] = []
  const register = vi.fn((definition: ConversationNodeDefinition) => {
    definitions.push(definition)
    return () => {}
  })
  ctx.provide('uiConversation', { events: { register } } as never)
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, definitions, register }
}

describe('ui-task-report browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'uiConversation'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { applyNode() }).not.toThrow()
  })

  it('registers the turn-scoped fold and the turn-tail row', async () => {
    const { ctx, definitions, register } = await bench()
    expect(register).toHaveBeenCalledExactlyOnceWith(taskReportDefinition)
    expect(definitions).toEqual([taskReportDefinition])

    const entry = ctx.slots.entries('conversation.chat.turnTail')[0]
    expect(entry?.component).toBe(TaskReportCard)
    expect(entry?.select).toBe(selectTaskReport)
    expect(entry?.locale).toBe(NS)
  })

  it('releases the row and the dictionaries with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('row.title')).toBe(zh['row.title'])

    await fiber.dispose()
    expect(ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(0)
    // Withdrawn dictionaries leave the key unresolved rather than translated.
    expect(translate('row.title')).not.toBe(zh['row.title'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
