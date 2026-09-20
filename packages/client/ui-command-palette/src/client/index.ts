/**
 * Command-palette plugin, browser half: ShortcutRegistry (`ctx.shortcuts`,
 * the global keydown layer) plus one `shell.overlay` entry rendering the
 * Cmd/Ctrl+K palette over the current session's commands and the two
 * conversation actions this surface owns.
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
import type { ShortcutContract } from './contract.ts'
import { en, NS, zh } from './locales.ts'
import { CommandPaletteController } from './palette.ts'
import { ShortcutRegistry } from './shortcuts.ts'

export type { CommandPaletteInjected, CommandPaletteProps } from './CommandPalette.tsx'
export type { CommandPaletteKey } from './locales.ts'
export type { ShortcutBinding, ShortcutContract } from './contract.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Global keyboard-shortcut registry (`register` only). */
    shortcuts: ShortcutContract
  }
}

/** Required services: the slot registry, locale registry, command surface, and session objects. */
export const inject = ['slots', 'locale', 'commandUi', 'sessions']

/**
 * Mount the shortcut registry and the palette overlay, and bind the palette's
 * open chords to the controller the overlay renders.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-command-palette: dictionaries')
  ctx.plugin(ShortcutRegistry)

  ctx.inject(['slots', 'shortcuts', 'commandUi', 'sessions', 'locale'], (scope: ClientContext) => {
    const controller = new CommandPaletteController({
      commands: scope.commandUi,
      sessions: scope.sessions,
      // Workspace navigation is optional and read per pick: the palette
      // still runs commands when a deployment mounts no Workspace UI, and the
      // Workspace UI can register after this plugin's activation.
      workspace: () => scope.get('uiWorkspace'),
      t: scope.locale.bind(NS),
    })

    for (const keys of ['mod+k', 'mod+shift+p']) {
      scope.effect(() => scope.shortcuts.register({
        id: `command-palette.open:${keys}`,
        keys,
        run: () => { controller.toggle() },
      }), `ui-command-palette: ${keys}`)
    }

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
