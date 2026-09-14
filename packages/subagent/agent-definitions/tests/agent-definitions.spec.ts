import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import AgentDefinitionsRegistry, {
  isAgentDefinitionName,
  type AgentDefinition,
  type AgentDefinitionCandidate,
  type AgentDefinitionLookupOptions,
  type AgentDefinitionProvider,
  type AgentDefinitionProviderControl,
  type AgentDefinitionProviderObservation,
} from '../src/index.ts'

function definition(name: string, overrides: Partial<AgentDefinitionCandidate> = {}): AgentDefinitionCandidate {
  return {
    name,
    description: `${name} description`,
    provider: 'memory',
    source: 'test',
    rank: 0,
    locator: { body: `${name} body.` },
    ...overrides,
  }
}

function memoryProvider(name: string, definitions: AgentDefinitionCandidate[]): AgentDefinitionProvider {
  return {
    name,
    list: () => Promise.resolve(definitions),
    get: candidate => Promise.resolve({ ...candidate, instructions: `${candidate.name} instructions.` }),
  }
}

/** The registry as a scoped caller resolves it (scope contexts declare no inject). */
function registryOf(ctx: Context): AgentDefinitionsRegistry {
  const registry = ctx.get('agentDefinitions')
  if (registry === undefined) throw new Error('agentDefinitions service missing')
  return registry
}

describe('isAgentDefinitionName', () => {
  it('accepts kebab-case names and rejects every other spelling', () => {
    expect(isAgentDefinitionName('reviewer')).toBe(true)
    expect(isAgentDefinitionName('code-reviewer')).toBe(true)
    expect(isAgentDefinitionName('a1-b2-c3')).toBe(true)
    expect(isAgentDefinitionName('Code-Reviewer')).toBe(false)
    expect(isAgentDefinitionName('code_reviewer')).toBe(false)
    expect(isAgentDefinitionName('-code')).toBe(false)
    expect(isAgentDefinitionName('code-')).toBe(false)
    expect(isAgentDefinitionName('code--reviewer')).toBe(false)
    expect(isAgentDefinitionName('')).toBe(false)
  })
})

describe('AgentDefinitionsRegistry registration', () => {
  it('registers unique providers per layer and rejects a duplicate name with an aborted lifecycle', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    const disposeFirst = ctx.agentDefinitions.registerProvider(() => memoryProvider('memory', [definition('alpha')]))
    ctx.agentDefinitions.registerProvider(() => memoryProvider('second', [definition('beta')]))

    expect((await ctx.agentDefinitions.list()).map(summary => summary.name)).toEqual(['alpha', 'beta'])

    let duplicateSignal: AbortSignal | undefined
    expect(() => ctx.agentDefinitions.registerProvider((control) => {
      duplicateSignal = control.signal
      return memoryProvider('memory', [])
    })).toThrow('an agent-definition provider named "memory" is already registered')
    expect(duplicateSignal?.aborted).toBe(true)

    disposeFirst()
    expect((await ctx.agentDefinitions.list()).map(summary => summary.name)).toEqual(['beta'])
  })

  it('unregisters through the returned disposer and aborts the registration lifecycle', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    let lifecycle: AbortSignal | undefined
    const dispose = ctx.agentDefinitions.registerProvider((control) => {
      lifecycle = control.signal
      return memoryProvider('memory', [definition('alpha')])
    })

    expect(lifecycle?.aborted).toBe(false)
    expect((await ctx.agentDefinitions.list()).map(summary => summary.name)).toEqual(['alpha'])

    dispose()
    expect(lifecycle?.aborted).toBe(true)
    expect(lifecycle?.reason).toEqual(new Error('agent-definition provider "memory" disposed'))
    expect(await ctx.agentDefinitions.list()).toEqual([])
  })

  it('aborts the lifecycle signal and rethrows when the provider factory throws', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    const failure = new Error('factory failed')
    let lifecycle: AbortSignal | undefined

    expect(() => ctx.agentDefinitions.registerProvider((control) => {
      lifecycle = control.signal
      throw failure
    })).toThrow(failure)
    expect(lifecycle?.aborted).toBe(true)
    expect(lifecycle?.reason).toBe(failure)
  })
})

describe('AgentDefinitionsRegistry scope layers', () => {
  it('files a scoped provider into its own layer, visible only along that scope chain', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    ctx.agentDefinitions.registerProvider(() => memoryProvider('global', [
      definition('global-only'),
      definition('shared', { description: 'Global shared', rank: 1 }),
    ]))
    const preset = createScope(ctx, { preset: 'a' })
    registryOf(preset.ctx).registerProvider(() => ({
      name: 'preset',
      list: () => Promise.resolve([
        definition('preset-only', { provider: 'preset' }),
        definition('shared', { description: 'Preset shared', provider: 'preset', rank: 900 }),
      ]),
      get: candidate => Promise.resolve({ ...candidate, instructions: `${candidate.description} body.` }),
    }))

    expect((await ctx.agentDefinitions.list()).map(summary => summary.name)).toEqual(['global-only', 'shared'])
    const scoped = await ctx.agentDefinitions.list({ scope: scopeOf(preset.ctx) })
    expect(scoped.map(summary => [summary.name, summary.description])).toEqual([
      ['global-only', 'global-only description'],
      ['preset-only', 'preset-only description'],
      ['shared', 'Preset shared'],
    ])
    expect((await ctx.agentDefinitions.get('shared', { scope: scopeOf(preset.ctx) }))?.instructions)
      .toBe('Preset shared body.')
    expect(await ctx.agentDefinitions.get('preset-only')).toBeUndefined()
    await preset.dispose()
  })

  it('gives the nearest layer the final word along a chain regardless of rank', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    ctx.agentDefinitions.registerProvider(() => memoryProvider('global', [
      definition('shared', { description: 'Global', rank: 1 }),
    ]))
    const preset = createScope(ctx, { preset: 'outer' })
    registryOf(preset.ctx).registerProvider(() => memoryProvider('preset', [
      definition('shared', { description: 'Preset', rank: 500 }),
    ]))
    const agentKey = {}
    const agentScope = createScope(ctx, agentKey, { parent: scopeOf(preset.ctx) as object })
    registryOf(agentScope.ctx).registerProvider(() => memoryProvider('agent', [
      definition('shared', { description: 'Agent', rank: 9000 }),
    ]))

    expect((await ctx.agentDefinitions.list({ scope: agentKey })).map(summary => summary.description)).toEqual(['Agent'])
    expect((await ctx.agentDefinitions.list()).map(summary => summary.description)).toEqual(['Global'])

    await agentScope.dispose()
    expect((await ctx.agentDefinitions.list({ scope: agentKey })).map(summary => summary.description)).toEqual(['Preset'])

    await preset.dispose()
    expect((await ctx.agentDefinitions.list({ scope: agentKey })).map(summary => summary.description)).toEqual(['Global'])
  })

  it('scopes provider-name uniqueness per layer and reports scoped duplicates distinctly', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    ctx.agentDefinitions.registerProvider(() => memoryProvider('memory', []))
    const presetA = createScope(ctx, { preset: 'a' })
    const presetB = createScope(ctx, { preset: 'b' })
    registryOf(presetA.ctx).registerProvider(() => memoryProvider('memory', [definition('a-only')]))
    registryOf(presetB.ctx).registerProvider(() => memoryProvider('memory', [definition('b-only')]))

    expect(() => registryOf(presetA.ctx).registerProvider(() => memoryProvider('memory', [])))
      .toThrow('an agent-definition provider named "memory" is already registered in this scope')
    expect((await ctx.agentDefinitions.list({ scope: scopeOf(presetA.ctx) })).map(summary => summary.name))
      .toEqual(['a-only'])
    expect((await ctx.agentDefinitions.list({ scope: scopeOf(presetB.ctx) })).map(summary => summary.name))
      .toEqual(['b-only'])

    await presetA.dispose()
    expect((await ctx.agentDefinitions.list({ scope: scopeOf(presetB.ctx) })).map(summary => summary.name))
      .toEqual(['b-only'])
    await presetB.dispose()
    expect(await ctx.agentDefinitions.list({ scope: scopeOf(presetB.ctx) })).toEqual([])
  })
})

describe('AgentDefinitionsRegistry catalog reads', () => {
  it('sorts summaries by name across providers and keeps only the supplied narrowing fields', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    ctx.agentDefinitions.registerProvider(() => memoryProvider('zeta', [
      definition('zulu', {
        provider: 'zeta',
        tools: ['read'],
        model: 'model-a',
        reasoningEffort: 'high',
        maxDepth: 2,
        path: '/defs/zulu.md',
      }),
    ]))
    ctx.agentDefinitions.registerProvider(() => memoryProvider('alpha', [definition('alpha', { provider: 'alpha' })]))

    expect(await ctx.agentDefinitions.list()).toStrictEqual([
      { name: 'alpha', description: 'alpha description', source: 'test', provider: 'alpha' },
      {
        name: 'zulu',
        description: 'zulu description',
        source: 'test',
        provider: 'zeta',
        tools: ['read'],
        model: 'model-a',
        reasoningEffort: 'high',
        maxDepth: 2,
        path: '/defs/zulu.md',
      },
    ])
  })

  it('reports completeness for array shorthand, partial observations, and plain arrays', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    ctx.agentDefinitions.registerProvider(() => memoryProvider('memory', [definition('alpha')]))

    expect(await ctx.agentDefinitions.snapshot()).toStrictEqual({
      definitions: [{ name: 'alpha', description: 'alpha description', source: 'test', provider: 'memory' }],
      complete: true,
    })

    const partial = new Context()
    await partial.plugin(AgentDefinitionsRegistry)
    partial.agentDefinitions.registerProvider(() => ({
      name: 'partial',
      list: () => Promise.resolve({ definitions: [definition('beta')], complete: false }),
      get: () => Promise.resolve(undefined),
    }))

    expect(await partial.agentDefinitions.snapshot()).toMatchObject({
      definitions: [{ name: 'beta' }],
      complete: false,
    })
    expect((await partial.agentDefinitions.list()).map(summary => summary.name)).toEqual(['beta'])
  })

  it('contains a rejecting provider with a warning while the rest of the catalog still contributes', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    ctx.agentDefinitions.registerProvider(() => ({
      name: 'failing',
      list: () => Promise.reject(new Error('discovery failed')),
      get: () => Promise.resolve(undefined),
    }))
    ctx.agentDefinitions.registerProvider(() => memoryProvider('memory', [definition('alpha')]))

    const snapshot = await ctx.agentDefinitions.snapshot()
    expect(snapshot.definitions.map(summary => summary.name)).toEqual(['alpha'])
    expect(snapshot.complete).toBe(false)
    expect(warnings).toEqual(['agent-definition provider "failing" skipped: Error: discovery failed'])
  })

  it('contains a provider failure whose string coercion throws', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    ctx.agentDefinitions.registerProvider(() => ({
      name: 'hostile-failure',
      list() {
        // Deliberately violate the provider contract to prove containment is total.
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors
        return Promise.reject({ toString() { throw new Error('coercion failed') } })
      },
      get: () => Promise.resolve(undefined),
    }))

    await expect(ctx.agentDefinitions.list()).resolves.toEqual([])
    expect(warnings).toEqual(['agent-definition provider "hostile-failure" skipped: [unrenderable thrown value]'])
  })

  it('normalizes an unrenderable provider rejection through a hostile prototype trap', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('prototype trap') } })
    ctx.agentDefinitions.registerProvider(() => ({
      name: 'trap',
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors
      list: () => Promise.reject(hostile),
      get: () => Promise.resolve(undefined),
    }))

    await expect(ctx.agentDefinitions.list({ signal: new AbortController().signal })).resolves.toEqual([])
    expect(warnings).toEqual(['agent-definition provider "trap" skipped: Error: [object Object]'])
  })

  it('resolves duplicate definition names by rank, then provider order, then local order', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    ctx.agentDefinitions.registerProvider(() => memoryProvider('first', [
      definition('by-rank', { description: 'First low', provider: 'first', rank: 10 }),
      definition('by-order', { description: 'First', provider: 'first', rank: 5 }),
      definition('by-local', { description: 'Kept', provider: 'first', rank: 5 }),
      definition('by-local', { description: 'Dropped', provider: 'first', rank: 5 }),
    ]))
    ctx.agentDefinitions.registerProvider(() => memoryProvider('second', [
      definition('by-rank', { description: 'Second high', provider: 'second', rank: 1 }),
      definition('by-order', { description: 'Second', provider: 'second', rank: 5 }),
    ]))

    expect((await ctx.agentDefinitions.list()).map(summary => [summary.name, summary.description, summary.provider]))
      .toEqual([
        ['by-local', 'Kept', 'first'],
        ['by-order', 'First', 'first'],
        ['by-rank', 'Second high', 'second'],
      ])
    expect(warnings).toEqual([
      'agent definition "by-local" from test ignored because a higher-priority definition already exists',
      'agent definition "by-order" from test ignored because a higher-priority definition already exists',
      'agent definition "by-rank" from test ignored because a higher-priority definition already exists',
    ])
    expect(await ctx.agentDefinitions.get('by-local')).toMatchObject({ description: 'Kept' })
  })

  it('orders candidates by rank, provider order, local order, then name code points', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    ctx.agentDefinitions.registerProvider(() => memoryProvider('memory', [definition('zulu'), definition('alpha')]))
    const indexed = (name: string, rank: number, providerOrder = 0, localOrder = 0): unknown => ({
      candidate: { name, rank } as AgentDefinitionCandidate,
      provider: { name: 'memory' } as AgentDefinitionProvider,
      providerOrder,
      localOrder,
    })
    const comparators: ((left: never, right: never) => number)[] = []
    const sort = vi.spyOn(Array.prototype, 'sort')
    let listed: string[]
    try {
      listed = (await ctx.agentDefinitions.list()).map(summary => summary.name)
      for (const call of sort.mock.calls) {
        if (typeof call[0] === 'function') comparators.push(call[0] as (left: never, right: never) => number)
      }
    } finally {
      sort.mockRestore()
    }

    expect(listed).toEqual(['alpha', 'zulu'])
    const compare = comparators.find(candidate => candidate(indexed('b', 1) as never, indexed('a', 2) as never) === -1)
    expect(compare).toBeTypeOf('function')
    const ordered = compare as (left: unknown, right: unknown) => number
    expect(ordered(indexed('b', 1), indexed('a', 2))).toBe(-1)
    expect(ordered(indexed('a', 2), indexed('b', 1))).toBe(1)
    expect(ordered(indexed('same', 1, 0, 0), indexed('same', 1, 1, 0))).toBe(-1)
    expect(ordered(indexed('same', 1, 0, 1), indexed('same', 1, 0, 0))).toBe(1)
    expect(ordered(indexed('a', 1), indexed('b', 1))).toBe(-1)
    expect(ordered(indexed('b', 1), indexed('a', 1))).toBe(1)
    expect(ordered(indexed('same', 1), indexed('same', 1))).toBe(0)
  })
})

describe('AgentDefinitionsRegistry definition loading', () => {
  it('loads the winning definition and borrows the exact candidate and lookup options', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    const lookup: AgentDefinitionLookupOptions = { cwd: '/workspace/a' }
    const candidate = definition('alpha')
    const loaded: AgentDefinition = { ...candidate, instructions: 'Alpha instructions.' }
    let listedWith: AgentDefinitionLookupOptions | undefined
    let loadedWith: AgentDefinitionLookupOptions | undefined
    let received: AgentDefinitionCandidate | undefined
    ctx.agentDefinitions.registerProvider(() => ({
      name: 'memory',
      list: (options) => {
        listedWith = options
        return Promise.resolve([candidate])
      },
      get: (entry, options) => {
        received = entry
        loadedWith = options
        return Promise.resolve(loaded)
      },
    }))

    expect(await ctx.agentDefinitions.get('alpha', lookup)).toBe(loaded)
    expect(received).toBe(candidate)
    expect(listedWith).toBe(lookup)
    expect(loadedWith).toBe(lookup)
  })

  it('returns undefined for invalid grammar without consulting any provider', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    let listCalls = 0
    ctx.agentDefinitions.registerProvider(() => ({
      name: 'memory',
      list: () => {
        listCalls += 1
        return Promise.resolve([definition('alpha')])
      },
      get: () => Promise.reject(new Error('get must not run')),
    }))

    expect(await ctx.agentDefinitions.get('Bad_Name')).toBeUndefined()
    expect(await ctx.agentDefinitions.get('')).toBeUndefined()
    expect(listCalls).toBe(0)
  })

  it('returns undefined for unknown names, vanished bodies, and renamed bodies', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    ctx.agentDefinitions.registerProvider(() => ({
      name: 'vanishing',
      list: () => Promise.resolve([definition('vanishing'), definition('renamed')]),
      get: entry => entry.name === 'renamed'
        ? Promise.resolve({ ...entry, name: 'other-name', instructions: 'Renamed body.' })
        : Promise.resolve(undefined),
    }))

    expect(await ctx.agentDefinitions.get('unknown-name')).toBeUndefined()
    expect(await ctx.agentDefinitions.get('vanishing')).toBeUndefined()
    expect(await ctx.agentDefinitions.get('renamed')).toBeUndefined()
  })

  it('throws when the loaded definition omits instructions', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    ctx.agentDefinitions.registerProvider(() => ({
      name: 'memory',
      list: () => Promise.resolve([definition('alpha')]),
      get: entry => Promise.resolve({ ...entry, instructions: '' }),
    }))

    await expect(ctx.agentDefinitions.get('alpha')).rejects
      .toThrow('agent-definition provider "memory" returned definition "alpha" without instructions')
  })
})

describe('AgentDefinitionsRegistry validation', () => {
  it('rejects every malformed provider observation', async () => {
    const malformed: unknown[] = [
      null,
      1,
      'definitions',
      {},
      { definitions: [] },
      { complete: true },
      { definitions: 'x', complete: true },
      { definitions: [], complete: 'yes' },
    ]
    for (const [index, output] of malformed.entries()) {
      const ctx = new Context()
      await ctx.plugin(AgentDefinitionsRegistry)
      ctx.agentDefinitions.registerProvider(() => ({
        name: `malformed-${index}`,
        list: () => Promise.resolve(output as readonly AgentDefinitionCandidate[] | AgentDefinitionProviderObservation),
        get: () => Promise.resolve(undefined),
      }))

      await expect(ctx.agentDefinitions.list()).rejects
        .toThrow(`agent-definition provider "malformed-${index}" list() must return an array or { definitions, complete } observation`)
    }
  })

  it('rejects every malformed candidate field', async () => {
    const cases: { patch: Partial<AgentDefinitionCandidate>; expected: string }[] = [
      { patch: { name: { value: 'candidate' } as unknown as string }, expected: 'returned a definition with an invalid name' },
      { patch: { name: 'Bad_Name' }, expected: 'returned a definition with an invalid name' },
      { patch: { description: { value: 'description' } as unknown as string }, expected: 'returned definition "candidate" without a description' },
      { patch: { description: '' }, expected: 'returned definition "candidate" without a description' },
      { patch: { provider: { value: 'provider' } as unknown as string }, expected: 'returned definition "candidate" without a provider name' },
      { patch: { provider: '' }, expected: 'returned definition "candidate" without a provider name' },
      { patch: { source: 1 as unknown as string }, expected: 'returned definition "candidate" without a source' },
      { patch: { source: '' }, expected: 'returned definition "candidate" without a source' },
      { patch: { rank: 1.5 }, expected: 'returned definition "candidate" with a non-integer rank' },
      { patch: { tools: {} as unknown as readonly string[] }, expected: 'returned definition "candidate" with an invalid tools allow-list' },
      { patch: { tools: [] }, expected: 'returned definition "candidate" with an invalid tools allow-list' },
      { patch: { tools: [''] }, expected: 'returned definition "candidate" with an invalid tools allow-list' },
      { patch: { tools: [1 as unknown as string] }, expected: 'returned definition "candidate" with an invalid tools allow-list' },
      { patch: { model: 1 as unknown as string }, expected: 'returned definition "candidate" with an invalid model' },
      { patch: { model: '' }, expected: 'returned definition "candidate" with an invalid model' },
      { patch: { reasoningEffort: 1 as unknown as string }, expected: 'returned definition "candidate" with an invalid reasoning effort' },
      { patch: { reasoningEffort: '' }, expected: 'returned definition "candidate" with an invalid reasoning effort' },
      { patch: { maxDepth: 1.5 }, expected: 'returned definition "candidate" with an invalid maxDepth' },
      { patch: { maxDepth: -1 }, expected: 'returned definition "candidate" with an invalid maxDepth' },
    ]

    for (const [index, { patch, expected }] of cases.entries()) {
      const ctx = new Context()
      await ctx.plugin(AgentDefinitionsRegistry)
      const providerName = `candidate-${index}`
      ctx.agentDefinitions.registerProvider(() => ({
        name: providerName,
        list: () => Promise.resolve([{
          ...definition('candidate', { provider: providerName }),
          ...patch,
        }]),
        get: () => Promise.resolve(undefined),
      }))

      await expect(ctx.agentDefinitions.list()).rejects
        .toThrow(`agent-definition provider "${providerName}" ${expected}`)
    }
  })
})

describe('AgentDefinitionsRegistry cancellation', () => {
  it('throws for an already-aborted signal without calling any provider', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    let listCalls = 0
    ctx.agentDefinitions.registerProvider(() => ({
      name: 'memory',
      list: () => {
        listCalls += 1
        return Promise.resolve([definition('alpha')])
      },
      get: () => Promise.resolve(undefined),
    }))
    const controller = new AbortController()
    const reason = new Error('caller cancelled')
    controller.abort(reason)

    await expect(ctx.agentDefinitions.list({ signal: controller.signal })).rejects.toBe(reason)
    await expect(ctx.agentDefinitions.snapshot({ signal: controller.signal })).rejects.toBe(reason)
    await expect(ctx.agentDefinitions.get('alpha', { signal: controller.signal })).rejects.toBe(reason)
    expect(listCalls).toBe(0)
  })

  it('lets a cooperating provider finish while a signal is armed', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    ctx.agentDefinitions.registerProvider(() => memoryProvider('memory', [definition('alpha')]))
    const controller = new AbortController()

    expect((await ctx.agentDefinitions.list({ signal: controller.signal })).map(summary => summary.name)).toEqual(['alpha'])
    expect((await ctx.agentDefinitions.get('alpha', { signal: controller.signal }))?.instructions)
      .toBe('alpha instructions.')
  })

  it('abandons a provider that never settles once the lookup aborts', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    const controller = new AbortController()
    const started = Promise.withResolvers<AbortSignal | undefined>()
    let release: (value: readonly AgentDefinitionCandidate[]) => void = () => {}
    const held = new Promise<readonly AgentDefinitionCandidate[]>((resolve) => { release = resolve })
    ctx.agentDefinitions.registerProvider(() => ({
      name: 'uncooperative',
      list: (options) => {
        started.resolve(options.signal)
        return held
      },
      get: () => Promise.resolve(undefined),
    }))

    const reason = new Error('discovery cancelled')
    const pending = ctx.agentDefinitions.list({ signal: controller.signal })
    const outcome = pending.then(
      () => 'resolved',
      (error: unknown) => error === reason ? 'aborted' : 'other-error',
    )
    expect(await started.promise).toBe(controller.signal)
    controller.abort(reason)

    expect(await outcome).toBe('aborted')
    release([])
    await pending.catch(() => undefined)
  })

  it('rejects an in-flight read when a provider aborts its own lookup signal', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    const controller = new AbortController()
    const reason = new Error('provider cancelled')
    ctx.agentDefinitions.registerProvider(() => ({
      name: 'self-abort',
      list: () => {
        controller.abort(reason)
        return Promise.resolve([definition('alpha')])
      },
      get: () => Promise.resolve(undefined),
    }))

    await expect(ctx.agentDefinitions.list({ signal: controller.signal })).rejects.toBe(reason)
  })

  it('surfaces the abort reason instead of the containment warning when a provider fails under an aborted lookup', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    const controller = new AbortController()
    const reason = new Error('aborted before the provider failed')
    ctx.agentDefinitions.registerProvider(() => ({
      name: 'failing-under-abort',
      list: () => {
        controller.abort(reason)
        const failure = Promise.reject(new Error('provider failed anyway'))
        // The registry abandons this promise once it sees the armed signal, so
        // the test owns its rejection to keep the failure contained.
        void failure.catch(() => undefined)
        return failure
      },
      get: () => Promise.resolve(undefined),
    }))

    await expect(ctx.agentDefinitions.list({ signal: controller.signal })).rejects.toBe(reason)
    expect(warnings).toEqual([])
  })

  it('renders a non-Error abort reason as a total Error', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    let listCalls = 0
    ctx.agentDefinitions.registerProvider(() => ({
      name: 'memory',
      list: () => {
        listCalls += 1
        return Promise.resolve([definition('alpha')])
      },
      get: () => Promise.resolve(undefined),
    }))
    const controller = new AbortController()
    controller.abort('stop')

    const failure: unknown = await ctx.agentDefinitions.list({ signal: controller.signal })
      .then(() => 'resolved', (error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('stop')
    await expect(ctx.agentDefinitions.get('alpha', { signal: controller.signal })).rejects.toThrow('stop')
    expect(listCalls).toBe(0)
  })

  it('rechecks cancellation between discovery and loading', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    const controller = new AbortController()
    const reason = new Error('cancelled after discovery')
    let getCalls = 0
    const late = {
      ...definition('late-abort'),
      get source(): string {
        controller.abort(reason)
        return 'test'
      },
    }
    ctx.agentDefinitions.registerProvider(() => ({
      name: 'late',
      list: () => Promise.resolve([late]),
      get: () => {
        getCalls += 1
        return Promise.resolve(undefined)
      },
    }))

    await expect(ctx.agentDefinitions.get('late-abort', { signal: controller.signal })).rejects.toBe(reason)
    expect(getCalls).toBe(0)
  })
})

describe('AgentDefinitionsRegistry change events', () => {
  it('dispatches on registration, disposal, and invalidate, and ignores invalidate after disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    const changes = vi.fn()
    ctx.on('agent-definitions/change', changes)
    let control: AgentDefinitionProviderControl | undefined
    const dispose = ctx.agentDefinitions.registerProvider((given) => {
      control = given
      return memoryProvider('memory', [definition('alpha')])
    })

    expect(changes).toHaveBeenCalledTimes(1)
    control?.invalidate()
    expect(changes).toHaveBeenCalledTimes(2)
    dispose()
    expect(changes).toHaveBeenCalledTimes(3)
    expect(() => control?.invalidate()).not.toThrow()
    expect(changes).toHaveBeenCalledTimes(3)
  })

  it('contains throwing and rejecting listeners and still runs the other listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefinitionsRegistry)
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    const disposeThrowing = ctx.on('agent-definitions/change', () => { throw new Error('listener threw') })
    // oxlint-disable-next-line typescript/no-misused-promises -- deliberate rejection proves notification containment
    const disposeRejecting = ctx.on('agent-definitions/change', () => Promise.reject(new Error('listener rejected')))
    let observed = 0
    const disposeObserver = ctx.on('agent-definitions/change', () => { observed += 1 })

    expect(() => ctx.agentDefinitions.registerProvider(() => memoryProvider('memory', []))).not.toThrow()
    await Promise.resolve()
    expect(observed).toBe(1)
    expect(warnings).toEqual([
      'agent-definitions/change listener threw: Error: listener threw',
      'agent-definitions/change listener rejected: Error: listener rejected',
    ])

    disposeThrowing()
    disposeRejecting()
    disposeObserver()
  })
})
