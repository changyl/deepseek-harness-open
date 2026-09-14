/**
 * Durable model-facing catalog of available agent definitions.
 *
 * The catalog reuses the released `plugin` message source instead of adding a
 * source kind, so publishing it changes no session format. Its identity is the
 * rendered text, which makes publication idempotent across tool instances and
 * steps: an instance that finds the same list already visible publishes
 * nothing.
 *
 * @module @deepseek-ai/dsh-tool-subagent/agent-catalog
 */

import { createHash } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { AgentDefinitionSummary } from '@deepseek-ai/dsh-agent-definitions'

/**
 * Durable `plugin` source id identifying this catalog among context messages.
 * It is deliberately distinct from the plugin name so the catalog is
 * distinguishable from any other message that plugin source produces.
 */
export const AGENT_CATALOG_PLUGIN = 'tool-subagent/agent-catalog'

/** One catalog line: the definition name and its capped routing description. */
export interface AgentCatalogEntry {
  readonly name: string
  readonly description: string
}

/**
 * Project definitions into catalog entries with normalized, capped descriptions.
 * @param definitions - winning definitions from the registry.
 * @param descriptionMaxLength - maximum normalized description length.
 * @returns catalog entries in definition order.
 */
export function agentCatalogEntries(
  definitions: readonly AgentDefinitionSummary[],
  descriptionMaxLength: number,
): AgentCatalogEntry[] {
  return definitions.map(definition => ({
    name: definition.name,
    description: catalogDescription(definition.description, descriptionMaxLength),
  }))
}

/**
 * Render the complete catalog message text.
 *
 * The frame is deliberately independent of the publishing tool instance: two
 * capable delegation tools in one composition render the same text, so the
 * second publishes nothing. The list is always presented as complete, which
 * makes a replacement self-describing on first publication too.
 * @param entries - catalog entries, possibly empty.
 * @returns the model-facing `<system-reminder>` text.
 */
export function renderAgentCatalog(entries: readonly AgentCatalogEntry[]): string {
  const lines = entries.length === 0
    ? ['- (none)']
    : entries.map(entry => `- \`${entry.name}\`: ${escapeCatalogText(entry.description)}`)
  return [
    '<system-reminder>',
    'Specialized subagents may be available for delegation. Each one runs with its own system prompt and tool access. This complete list replaces every earlier available-subagent list in this session:',
    '',
    '<available_subagents>',
    ...lines,
    '</available_subagents>',
    '',
    'When a task clearly matches a listed specialist, delegate to it with a delegation tool that offers `agent_type` and pass the exact listed name.',
    '</system-reminder>',
  ].join('\n')
}

/**
 * Identity of one rendered catalog.
 * @param text - rendered catalog text.
 * @returns hexadecimal digest used for publication and replacement decisions.
 */
export function digestAgentCatalog(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Build the durable user-role catalog message.
 * @param text - rendered catalog text.
 * @returns the sourced user message appended to the step.
 */
export function agentCatalogMessage(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: AGENT_CATALOG_PLUGIN },
  })
}

/**
 * Whether a message is this plugin's agent catalog.
 * @param source - message source to classify.
 * @returns whether the source is this catalog's plugin source.
 */
export function isAgentCatalogSource(source: unknown): boolean {
  if (typeof source !== 'object' || source === null) return false
  const candidate = source as { kind?: unknown; plugin?: unknown }
  return candidate.kind === 'plugin' && candidate.plugin === AGENT_CATALOG_PLUGIN
}

/**
 * Concatenate the text blocks of one message.
 * @param message - user message whose model-facing text is compared.
 * @returns the concatenated text blocks.
 */
export function messageText(message: UserMessage): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Digest of the catalog currently visible on the session surface.
 * @param agent - session owner whose visible surface supplies durable state.
 * @returns the visible catalog digest and whether any catalog was ever published.
 */
export function visibleAgentCatalog(agent: Agent): { digest?: string; published: boolean } {
  /* jscpd:ignore-start -- durable context catalogs scan the same visible Session surface the same way. */
  const visible = new Set(agent.session.surface.nodes)
  let published = false
  for (let index = agent.session.seq - 1; index >= 0; index -= 1) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = agent.session.eventAt(SessionSeq(index))
    /* v8 ignore next 3 -- A surface index below the session length is unreachable: the loop starts at seq - 1. */
    if (event === undefined) {
      throw new Error(`agent catalog cannot read seq ${String(index)} below the current Session length`)
    }
    if (event.type !== 'user/message') continue
    if (!isAgentCatalogSource(event.data.source)) continue
    published = true
    if (visible.has(event.seq)) return { digest: digestAgentCatalog(messageText(event.data)), published }
  }
  /* jscpd:ignore-end */
  return { published }
}

/**
 * The pending catalog message in one entering batch, if any.
 * @param messages - the step's claimed batch.
 * @returns the pending catalog message, or `undefined`.
 */
export function pendingAgentCatalog(messages: readonly UserMessage[]): UserMessage | undefined {
  return messages.find(message => isAgentCatalogSource(message.source))
}

function catalogDescription(value: string, maxLength: number): string {
  const normalized = value.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`
}

function escapeCatalogText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
