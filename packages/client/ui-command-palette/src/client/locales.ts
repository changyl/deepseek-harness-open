/**
 * Command-palette copy. The Chinese dictionary is the key-set source of
 * truth; the English dictionary is checked key-identical against it at the
 * typed registration site.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'

/** Dictionary namespace owned by this plugin. */
export const NS = 'commandPalette'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'palette.aria': '命令面板',
  'palette.placeholder': '输入命令或操作名称…',
  'palette.listbox': '命令与操作',
  'palette.section.actions': '操作',
  'palette.action.newSession': '新会话',
  'palette.action.newSession.description': '开始一个新的对话',
  'palette.action.stop': '停止生成',
  'palette.action.stop.description': '取消当前正在运行的轮次',
  'palette.status.loading': '正在加载命令…',
  'palette.status.noSession': '选择一个会话后可运行命令',
  'palette.status.empty': '没有匹配的命令',
  'palette.status.failed': '命令加载失败',
} as const

/** Key domain of the `commandPalette` namespace (zh is the source of truth). */
export type CommandPaletteKey = keyof typeof zh

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<CommandPaletteKey, string> = {
  'palette.aria': 'Command palette',
  'palette.placeholder': 'Type a command or action…',
  'palette.listbox': 'Commands and actions',
  'palette.section.actions': 'Actions',
  'palette.action.newSession': 'New Session',
  'palette.action.newSession.description': 'Start a new conversation',
  'palette.action.stop': 'Stop generating',
  'palette.action.stop.description': 'Cancel the running turn',
  'palette.status.loading': 'Loading commands…',
  'palette.status.noSession': 'Select a session to run commands',
  'palette.status.empty': 'No matching command',
  'palette.status.failed': 'Could not load commands',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Command-palette copy. */
    'commandPalette': CommandPaletteKey
  }
}

/** Namespace-addressed translate function the palette controller captures. */
export type CommandPaletteTranslate = TranslateNS<'commandPalette'>
