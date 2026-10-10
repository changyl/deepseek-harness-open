/**
 * Durable model-facing catalog of available agent definitions.
 *
 * The catalog is a `catalog`-form context that records exactly the entries it
 * published beside the model-facing prose, so its identity never depends on
 * re-parsing the `<available_subagents>` frame and a consumer presenting the
 * list never needs to. Publication is idempotent across tool instances and
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

/** One catalog line: the definition name and its capped routing description. */
export interface AgentCatalogEntry {
  readonly name: string
  readonly description: string
}

/**
 * Durable records for one published available-subagent catalog.
 */
export interface AgentCatalogSource {
  readonly kind: 'agent-catalog'
  readonly form: 'catalog'
  /** Exactly the entries this message published, in catalog order. */
  readonly entries: readonly AgentCatalogEntry[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-catalog': AgentCatalogSource
  }
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
 * Identity of one published catalog, over its durable entry list rather than the
 * rendered prose: the entries are what changes, and the surrounding
 * `<system-reminder>` framing is written for the model.
 * @param entries - published catalog entries.
 * @returns hexadecimal digest used for publication and replacement decisions.
 */
export function digestAgentCatalog(entries: readonly AgentCatalogEntry[]): string {
  // JSON per entry rather than a separator character: every separator is itself
  // a legal description character, so only quoting makes the boundary exact.
  const canonical = entries.map(entry => JSON.stringify([entry.name, entry.description])).join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Build the durable user-role catalog message.
 * @param entries - exactly the entries to publish, possibly empty.
 * @returns the sourced user message appended to the step.
 */
export function agentCatalogMessage(entries: readonly AgentCatalogEntry[]): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: renderAgentCatalog(entries) }],
    source: { kind: 'agent-catalog', form: 'catalog', entries },
  })
}

/**
 * Whether a message source is this plugin's agent catalog.
 * @param source - message source to classify.
 * @returns whether the source declares the catalog kind.
 */
export function isAgentCatalogSource(source: unknown): boolean {
  return typeof source === 'object' && source !== null
    && (source as { kind?: unknown }).kind === 'agent-catalog'
}

/**
 * Entries of one durable catalog source, or undefined when the record is not a
 * usable catalog.
 *
 * A resumed, forked, or externally written seed guarantees only a source object
 * with a non-empty `kind`; no per-kind field is validated there. An unreadable
 * record is therefore treated as "not this plugin's catalog" rather than
 * throwing inside the step listener, which would fail every subsequent turn of
 * that session.
 * @param source - source value read from a durable message.
 * @returns the recorded entries, or undefined when the record is unusable.
 */
export function readAgentCatalogEntries(source: unknown): AgentCatalogEntry[] | undefined {
  if (!isAgentCatalogSource(source)) return undefined
  const entries = (source as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return undefined
  const readable: AgentCatalogEntry[] = []
  for (const entry of entries as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const { name, description } = entry as { name?: unknown; description?: unknown }
    if (typeof name !== 'string' || name === '' || typeof description !== 'string') return undefined
    readable.push({ name, description })
  }
  return readable
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
    const entries = readAgentCatalogEntries(event.data.source)
    if (entries === undefined) continue
    const digest = digestAgentCatalog(entries)
    published = true
    if (visible.has(event.seq)) return { digest, published }
  }
  /* jscpd:ignore-end */
  return { published }
}

/**
 * The pending catalog message in one entering batch, if any.
 * @param messages - the step's claimed batch.
 * @returns the pending catalog message and its recorded entries, or `undefined`.
 */
export function pendingAgentCatalog(
  messages: readonly UserMessage[],
): { message: UserMessage; entries: AgentCatalogEntry[] } | undefined {
  for (const message of messages) {
    const entries = readAgentCatalogEntries(message.source)
    if (entries !== undefined) return { message, entries }
  }
  return undefined
}

function catalogDescription(value: string, maxLength: number): string {
  const normalized = value.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`
}

function escapeCatalogText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
