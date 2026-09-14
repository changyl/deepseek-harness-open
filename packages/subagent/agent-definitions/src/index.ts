/**
 * Agent definition provider registry.
 *
 * This package owns the Service Definition role of the agent-definition
 * capability seam. Concrete providers such as
 * `@deepseek-ai/dsh-agent-definitions-filesystem` decide where definitions come
 * from; this service merges provider catalogs, resolves the winning definition
 * for one name, and exposes summaries and full definitions to consumers.
 *
 * A definition describes one specialized child agent: its persona prose, the
 * tools it may use, and optional child route and delegation-depth limits. The
 * definition never grants a capability the spawning agent lacks — every field
 * narrows the composition the child would otherwise inherit.
 *
 * @module @deepseek-ai/dsh-agent-definitions
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { NamedEntries, ScopedLayers } from '@deepseek-ai/dsh-scope'
import type { ScopeKey, ScopeLayer } from '@deepseek-ai/dsh-scope'

const AGENT_DEFINITION_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Return whether a string is a valid kebab-case agent-definition name.
 * @param name - candidate definition name to validate.
 * @returns whether the name matches the public definition-name grammar.
 */
export function isAgentDefinitionName(name: string): boolean {
  return AGENT_DEFINITION_NAME.test(name)
}

/** Origin bucket for an agent definition. The value is metadata, not precedence by itself. */
export type AgentDefinitionSource =
  | 'project-dsh'
  | 'project-agents'
  | 'custom'
  | 'user-dsh'
  | 'user-agents'
  | (string & {})

/** Invocation-neutral agent-definition metadata returned by `ctx.agentDefinitions.list()`. */
export interface AgentDefinitionSummary {
  /** Kebab-case identifier a caller selects. */
  readonly name: string
  /** Short routing description shown by discovery consumers. */
  readonly description: string
  /** Discovery source that produced this winning definition. */
  readonly source: AgentDefinitionSource
  /** Provider that owns this definition body. */
  readonly provider: string
  /**
   * Allow-list of tool names the child may call. Omission inherits the tools
   * the child would otherwise see; the definition can only narrow that set.
   */
  readonly tools?: readonly string[]
  /** Requested child `agentOptions.model`. */
  readonly model?: string
  /** Requested child `agentOptions.reasoningEffort`. */
  readonly reasoningEffort?: string
  /** Absolute delegation-depth cap for the child. */
  readonly maxDepth?: number
  /** Absolute definition file path when supplied by the provider. */
  readonly path?: string
}

/** Provider catalog entry used by the registry to merge and later load definitions. */
export interface AgentDefinitionCandidate extends AgentDefinitionSummary {
  /** Lower ranks win duplicate names before provider registration order is considered. */
  readonly rank: number
  /** Opaque provider-owned handle passed back to `provider.get()`. */
  readonly locator: unknown
}

/** Complete agent definition, including the persona body loaded by `ctx.agentDefinitions.get()`. */
export interface AgentDefinition extends AgentDefinitionSummary {
  /** Persona prose installed as the child's `deployment:persona-prefix` shadow. */
  readonly instructions: string
}

/** Caller context used for cwd-sensitive and abortable provider work. */
export interface AgentDefinitionLookupOptions {
  /** Workspace selector for the current lookup. */
  readonly cwd?: string | undefined
  /** Aborts discovery or loading work for the current caller. */
  readonly signal?: AbortSignal | undefined
}

/** Registry read options: provider lookup context plus the viewing scope. */
export interface AgentDefinitionViewOptions extends AgentDefinitionLookupOptions {
  /** Viewing scope (the calling agent); omitted reads the global layer alone. */
  readonly scope?: ScopeKey | undefined
}

/** Provider catalog observation that distinguishes complete from partial discovery. */
export interface AgentDefinitionProviderObservation {
  /** Candidates usable by this read. */
  readonly definitions: readonly AgentDefinitionCandidate[]
  /** Whether discovery observed every source this provider owns. */
  readonly complete: boolean
}

/** One implementation of the agent-definition capability. */
export interface AgentDefinitionProvider {
  /** Unique provider name. */
  readonly name: string
  /**
   * List available definitions for the current lookup context. Provider plugins
   * register synchronously during `apply()`; remote initialization,
   * authentication, and discovery are awaited inside this method.
   * Implementations settle promptly when `options.signal` aborts.
   * @param options - lookup options; `cwd` selects workspace-sensitive definitions and `signal` cancels work.
   * @returns provider candidates as a complete-array shorthand, or an explicit
   *   observation when usable candidates came from incomplete discovery.
   */
  readonly list: (
    options: AgentDefinitionLookupOptions,
  ) => Promise<readonly AgentDefinitionCandidate[] | AgentDefinitionProviderObservation>
  /**
   * Load a complete definition body for a previously listed candidate.
   * @param candidate - the winning candidate originally returned by this provider.
   * @param options - lookup options; `cwd` selects workspace-sensitive definitions and `signal` cancels work.
   * @returns the full definition, or `undefined` if it is no longer loadable.
   */
  readonly get: (
    candidate: AgentDefinitionCandidate,
    options: AgentDefinitionLookupOptions,
  ) => Promise<AgentDefinition | undefined>
}

/** Registration-scoped lifecycle and invalidation capability borrowed by one provider. */
export interface AgentDefinitionProviderControl {
  /** Aborts if registration fails or when the exact provider registration is disposed. */
  readonly signal: AbortSignal
  /** Notify consumers that this provider's definitions may have changed, only while the exact registration remains active. */
  readonly invalidate: () => void
}

/** Registry catalog plus discovery-completeness state. */
export interface AgentDefinitionSnapshot {
  /** Winning definitions sorted by name. */
  readonly definitions: AgentDefinitionSummary[]
  /** Whether every registered provider observed its complete source set. */
  readonly complete: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentDefinitions: AgentDefinitionsRegistry
  }

  interface Events {
    /**
     * An agent-definition provider was registered, unregistered, or reported
     * that its definitions may have changed. This is an unfiltered
     * invalidation notification; consumers refetch the catalog for their own
     * lookup options. Listener failures are contained and cannot veto the
     * registry mutation.
     * @mode emit
     */
    'agent-definitions/change'(): void
  }
}

interface IndexedCandidate {
  candidate: AgentDefinitionCandidate
  provider: AgentDefinitionProvider
  providerOrder: number
  localOrder: number
}

/** One provider registration retained by its layer. */
interface RegisteredProvider {
  provider: AgentDefinitionProvider
  /** Service-wide monotonic registration order, the within-layer rank tiebreak. */
  order: number
}

/** One scope's complete agent-definition-registry contribution. */
class AgentDefinitionsLayer implements ScopeLayer {
  /** Providers registered through contexts carrying this scope, insertion-ordered. */
  readonly providers: NamedEntries<RegisteredProvider>

  constructor(scope: ScopeKey | undefined) {
    this.providers = new NamedEntries(name => new Error(scope === undefined
      ? `an agent-definition provider named "${name}" is already registered`
      : `an agent-definition provider named "${name}" is already registered in this scope`))
  }

  /** Whether every contribution table in this aggregate layer is empty. */
  isEmpty(): boolean {
    return this.providers.isEmpty()
  }
}

/**
 * Layered registry of agent-definition providers. A registration files into
 * the layer of its calling context's scope: host rows land in the global layer,
 * while a plugin mounted by an agent preset's standing composition lands in
 * that preset's layer. A read merges the global layer with the viewing scope's
 * chain — the nearest layer's entry wins a duplicate name outright, and the
 * rank order decides duplicates only within one layer.
 */
export class AgentDefinitionsRegistry extends Service {
  private readonly layers = new ScopedLayers<AgentDefinitionsLayer>(
    scope => new AgentDefinitionsLayer(scope),
    () => { this.notifyChange() },
  )
  private nextProviderOrder = 0

  constructor(ctx: Context) {
    super(ctx, 'agentDefinitions')
  }

  /**
   * Register a borrowed same-process provider synchronously during plugin
   * apply, into the calling context's layer: a scoped context registers for
   * that scope alone, an unscoped context registers globally. Duplicate names
   * within one layer throw; remote initialization belongs in `list()`. Fiber
   * disposal unregisters the provider and notifies consumers.
   * @param create - synchronous factory receiving this registration's lifecycle and invalidation control.
   * @returns the exact Cordis effect disposer that unregisters this provider.
   */
  registerProvider(create: (control: AgentDefinitionProviderControl) => AgentDefinitionProvider): () => void {
    const lifecycle = new AbortController()
    let registration: { layer: AgentDefinitionsLayer; name: string } | undefined
    let provider: AgentDefinitionProvider
    const control: AgentDefinitionProviderControl = {
      signal: lifecycle.signal,
      invalidate: () => {
        const active = registration
        if (active !== undefined && active.layer.providers.get(active.name)?.provider === provider) {
          this.notifyChange()
        }
      },
    }
    try {
      /* jscpd:ignore-start -- sibling scoped registries register a borrowed provider the same way. */
      provider = create(control)
      const name = provider.name
      const order = this.nextProviderOrder
      this.nextProviderOrder += 1
      return this.layers.effect(
        this.ctx,
        (layer) => {
          const undo = layer.providers.insert(name, { provider, order })
          registration = { layer, name }
          return () => {
            registration = undefined
            undo()
            lifecycle.abort(new Error(`agent-definition provider "${name}" disposed`))
          }
        },
        { label: 'agentDefinitions.registerProvider()' },
      )
    /* jscpd:ignore-end */
    } catch (error) {
      lifecycle.abort(error)
      throw error
    }
  }

  /**
   * List the winning definition summaries for the current lookup context.
   * @param options - view options; `scope` selects the viewing agent's layers,
   *   `cwd` selects workspace roots, and `signal` cancels discovery.
   * @returns sorted summaries; a partially observed catalog omits only the unavailable provider's definitions.
   */
  async list(options: AgentDefinitionViewOptions = {}): Promise<AgentDefinitionSummary[]> {
    return (await this.snapshot(options)).definitions
  }

  /**
   * Observe the current catalog and whether discovery completed. A partial
   * observation lets consumers keep last-good state instead of presenting a
   * transient provider failure as removal.
   * @param options - view options; `scope` selects the viewing agent's layers,
   *   `cwd` selects workspace roots, and `signal` cancels discovery.
   * @returns sorted summaries plus discovery-completeness state.
   */
  async snapshot(options: AgentDefinitionViewOptions = {}): Promise<AgentDefinitionSnapshot> {
    const collected = await this.collect(options)
    return {
      definitions: [...collected.entries.values()]
        .map(entry => toSummary(entry.candidate))
        .sort(compareSummary),
      complete: collected.complete,
    }
  }

  /**
   * Load and validate the winning definition, passing its opaque discovery
   * locator back to the provider.
   * @param name - kebab-case definition name.
   * @param options - view options; `scope` selects the viewing agent's layers, `cwd` selects workspace roots, and `signal` cancels work.
   * @returns the full definition, including persona prose, or `undefined`.
   */
  async get(name: string, options: AgentDefinitionViewOptions = {}): Promise<AgentDefinition | undefined> {
    /* jscpd:ignore-start -- sibling scoped registries resolve and validate one winning provider entry the same way. */
    if (!isAgentDefinitionName(name)) return undefined
    const collected = await this.collect(options)
    throwIfAborted(options.signal)
    const match = collected.entries.get(name)
    if (match === undefined) return undefined
    const definition = await waitWithAbort(
      match.provider.get(match.candidate, options),
      options.signal,
    )
    if (definition === undefined) return undefined
    validateDefinition(definition)
    if (definition.name !== match.candidate.name) return undefined
    return definition
  /* jscpd:ignore-end */
  }

  private async collect(options: AgentDefinitionViewOptions): Promise<{ entries: Map<string, IndexedCandidate>; complete: boolean }> {
    throwIfAborted(options.signal)
    // Global first, then existing chain overlays farthest ancestor first and
    // the exact scope last, so the nearest layer's same-name entry replaces
    // the farther ones. Rank decides duplicates only within one layer.
    const layers = [this.layers.global, ...this.layers.chainLayers(options.scope)]
    const entries = new Map<string, IndexedCandidate>()
    let complete = true
    for (const layer of layers) {
      const collected = await this.collectLayer(layer, options)
      if (!collected.complete) complete = false
      for (const entry of collected.entries) entries.set(entry.candidate.name, entry)
    }
    return { entries, complete }
  }

  private async collectLayer(
    layer: AgentDefinitionsLayer,
    options: AgentDefinitionLookupOptions,
  ): Promise<{ entries: IndexedCandidate[]; complete: boolean }> {
    const candidates: IndexedCandidate[] = []
    let complete = true
    for (const { provider, order } of [...layer.providers.values()]) {
      let output: unknown
      try {
        output = await waitWithAbort(provider.list(options), options.signal)
      } catch (error) {
        if (options.signal?.aborted === true) throw toError(options.signal.reason)
        complete = false
        this.ctx.logger.warn(`agent-definition provider "${provider.name}" skipped: ${errorMessage(error)}`)
        continue
      }
      const observation = normalizeProviderObservation(output, provider.name)
      if (!observation.complete) complete = false
      let localOrder = 0
      for (const candidate of observation.definitions) {
        validateCandidate(candidate, provider.name)
        candidates.push({ candidate, provider, providerOrder: order, localOrder })
        localOrder += 1
      }
    }
    candidates.sort(compareIndexedCandidates)
    const seen = new Set<string>()
    const result: IndexedCandidate[] = []
    for (const entry of candidates) {
      if (seen.has(entry.candidate.name)) {
        this.ctx.logger.warn(
          `agent definition "${entry.candidate.name}" from ${entry.candidate.source} ignored because a higher-priority definition already exists`,
        )
        continue
      }
      seen.add(entry.candidate.name)
      result.push(entry)
    }
    return { entries: result, complete }
  }

  /** Notify catalog observers without making their refresh work load-bearing. */
  private notifyChange(): void {
    for (const callback of this.ctx.events.dispatch('emit', ['agent-definitions/change'])) {
      try {
        const returned: unknown = callback()
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`agent-definitions/change listener rejected: ${errorMessage(error)}`)
        })
      } catch (error) {
        this.ctx.logger.warn(`agent-definitions/change listener threw: ${errorMessage(error)}`)
      }
    }
  }
}

function toSummary(candidate: AgentDefinitionCandidate): AgentDefinitionSummary {
  return {
    name: candidate.name,
    description: candidate.description,
    source: candidate.source,
    provider: candidate.provider,
    ...candidate.tools === undefined ? {} : { tools: candidate.tools },
    ...candidate.model === undefined ? {} : { model: candidate.model },
    ...candidate.reasoningEffort === undefined ? {} : { reasoningEffort: candidate.reasoningEffort },
    ...candidate.maxDepth === undefined ? {} : { maxDepth: candidate.maxDepth },
    ...candidate.path === undefined ? {} : { path: candidate.path },
  }
}

function compareSummary(left: AgentDefinitionSummary, right: AgentDefinitionSummary): number {
  return compareCodePoints(left.name, right.name)
}

function compareIndexedCandidates(left: IndexedCandidate, right: IndexedCandidate): number {
  if (left.candidate.rank !== right.candidate.rank) return left.candidate.rank - right.candidate.rank
  if (left.providerOrder !== right.providerOrder) return left.providerOrder - right.providerOrder
  if (left.localOrder !== right.localOrder) return left.localOrder - right.localOrder
  return compareCodePoints(left.candidate.name, right.candidate.name)
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeProviderObservation(output: unknown, providerName: string): AgentDefinitionProviderObservation {
  if (Array.isArray(output)) {
    return { definitions: output as readonly AgentDefinitionCandidate[], complete: true }
  }
  if (output === null || typeof output !== 'object') {
    throw invalidProviderObservation(providerName)
  }
  const observation = output as Partial<AgentDefinitionProviderObservation>
  if (!Array.isArray(observation.definitions) || typeof observation.complete !== 'boolean') {
    throw invalidProviderObservation(providerName)
  }
  return observation as AgentDefinitionProviderObservation
}

function invalidProviderObservation(providerName: string): TypeError {
  return new TypeError(
    `agent-definition provider "${providerName}" list() must return an array or { definitions, complete } observation`,
  )
}

function validateCandidate(candidate: AgentDefinitionCandidate, providerName: string): void {
  const origin = `agent-definition provider "${providerName}"`
  if (typeof candidate.name !== 'string' || !isAgentDefinitionName(candidate.name)) {
    throw new TypeError(`${origin} returned a definition with an invalid name`)
  }
  if (typeof candidate.description !== 'string' || candidate.description.length === 0) {
    throw new TypeError(`${origin} returned definition "${candidate.name}" without a description`)
  }
  if (typeof candidate.provider !== 'string' || candidate.provider.length === 0) {
    throw new TypeError(`${origin} returned definition "${candidate.name}" without a provider name`)
  }
  if (typeof candidate.source !== 'string' || candidate.source.length === 0) {
    throw new TypeError(`${origin} returned definition "${candidate.name}" without a source`)
  }
  if (!Number.isSafeInteger(candidate.rank)) {
    throw new TypeError(`${origin} returned definition "${candidate.name}" with a non-integer rank`)
  }
  if (candidate.tools !== undefined) {
    if (!Array.isArray(candidate.tools) || candidate.tools.length === 0
      || candidate.tools.some(tool => typeof tool !== 'string' || tool.length === 0)) {
      throw new TypeError(`${origin} returned definition "${candidate.name}" with an invalid tools allow-list`)
    }
  }
  if (candidate.model !== undefined && (typeof candidate.model !== 'string' || candidate.model.length === 0)) {
    throw new TypeError(`${origin} returned definition "${candidate.name}" with an invalid model`)
  }
  if (candidate.reasoningEffort !== undefined
    && (typeof candidate.reasoningEffort !== 'string' || candidate.reasoningEffort.length === 0)) {
    throw new TypeError(`${origin} returned definition "${candidate.name}" with an invalid reasoning effort`)
  }
  if (candidate.maxDepth !== undefined
    && (!Number.isSafeInteger(candidate.maxDepth) || candidate.maxDepth < 0)) {
    throw new TypeError(`${origin} returned definition "${candidate.name}" with an invalid maxDepth`)
  }
}

function validateDefinition(definition: AgentDefinition): void {
  validateCandidate({ ...definition, rank: 0, locator: undefined }, definition.provider)
  if (typeof definition.instructions !== 'string' || definition.instructions.length === 0) {
    throw new TypeError(`agent-definition provider "${definition.provider}" returned definition "${definition.name}" without instructions`)
  }
}

/* jscpd:ignore-start -- sibling scoped registries share abort-aware await and total error rendering. */
/** Wait for one provider promise while observing caller cancellation. */
function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(toError(signal.reason))
    }
    if (signal.aborted) {
      // The caller's abort wins, but the provider promise still settles later:
      // observe it so a late rejection cannot surface as an unhandled rejection.
      void promise.catch(() => {})
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(toError(error))
      },
    )
  })
}

/** Throw a total Error for an already-aborted lookup. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw toError(signal.reason)
}

/** Normalize an arbitrary abort or provider failure without trusting coercion. */
function toError(error: unknown): Error {
  try {
    if (error instanceof Error) return error
  } catch {
    // A hostile proxy may throw during instanceof; fall through to the total renderer.
  }
  return new Error(errorMessage(error))
}
/* jscpd:ignore-end */

/** Render an arbitrary provider failure without letting coercion escape containment. */
function errorMessage(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

export default AgentDefinitionsRegistry
