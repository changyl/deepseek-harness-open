/**
 * Command-palette plugin, browser half: one `shell.overlay` entry rendering
 * the Cmd/Ctrl+K palette over the current session's commands and the two
 * conversation actions this surface owns, plus its open chords on the shared
 * shortcuts service (`ctx.shortcuts`, owned by `dsh-client-shortcuts`).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the command surface contract (ctx.commandUi) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the 'shell.overlay' SlotMap declaration (the key's owner).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { CommandPalette } from './CommandPalette.tsx'
import type { CommandPaletteInjected } from './CommandPalette.tsx'
import { en, NS, zh } from './locales.ts'
import { installPaletteOpenShortcut } from './open-shortcut.ts'
import { CommandPaletteController } from './palette.ts'

export type { CommandPaletteInjected, CommandPaletteProps } from './CommandPalette.tsx'
export type { CommandPaletteKey } from './locales.ts'

/** Required services: the slot registry, locale registry, command surface, and session objects. */
export const inject = ['slots', 'locale', 'commandUi', 'sessions', 'uiSession']

/**
 * Mount the palette overlay and bind its open chords to the controller the
 * overlay renders.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-command-palette: dictionaries')

  ctx.inject(['slots', 'shortcuts', 'commandUi', 'sessions', 'uiSession', 'locale'], (scope: ClientContext) => {
    const t = scope.locale.bind(NS)
    const controller = new CommandPaletteController({
      commands: scope.commandUi,
      sessions: scope.sessions,
      // ui-session owns the current Session selection; the palette reads it at
      // open time through the same source the scoped renderer binds.
      currentSession: scope.uiSession.adapter.current,
      // Workspace navigation is optional and read per pick: the palette
      // still runs commands when a deployment mounts no Workspace UI, and the
      // Workspace UI can register after this plugin's activation.
      workspace: () => scope.get('uiWorkspace'),
      t,
    })

    scope.effect(
      () => installPaletteOpenShortcut(scope.shortcuts, t, () => { controller.toggle() }),
      'ui-command-palette: open chords',
    )

    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay',
      id: 'command-palette',
      order: 100,
      locale: NS,
      inject: (): CommandPaletteInjected => ({
        hooks: { palette: controller.state },
        close: () => { controller.close() },
        setQuery: (text) => { controller.setQuery(text) },
        move: (delta) => { controller.move(delta) },
        highlight: (index) => { controller.highlight(index) },
        run: (id) => { controller.run(id) },
        retry: () => { controller.open() },
      }),
    }, CommandPalette))
  })
}
