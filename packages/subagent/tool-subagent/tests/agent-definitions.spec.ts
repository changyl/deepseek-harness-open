import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentDefinitionsRegistry from '@deepseek-ai/dsh-agent-definitions'
import type { AgentDefinitionCandidate } from '@deepseek-ai/dsh-agent-definitions'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import {
  AGENT_CATALOG_PLUGIN,
  agentCatalogMessage,
  renderAgentCatalog,
  agentCatalogEntries,
  isAgentCatalogSource,
  visibleAgentCatalog,
} from '../src/agent-catalog.ts'
import { callSubagent, modelSelectionSetupAgent, setup, text } from './harness.ts'

interface StubDefinition {
  name: string
  description: string
  instructions: string
  tools?: readonly string[]
  model?: string
  reasoningEffort?: string
  maxDepth?: number
}

const REVIEWER: StubDefinition = {
  name: 'reviewer',
  description: 'Reviews a change for correctness and repo conventions.',
  instructions: 'You are a code reviewer.',
}

function candidateOf(definition: StubDefinition): AgentDefinitionCandidate {
  return {
    name: definition.name,
    description: definition.description,
    source: 'project-dsh',
    provider: 'stub',
    rank: 100,
    locator: definition,
    ...definition.tools === undefined ? {} : { tools: definition.tools },
    ...definition.model === undefined ? {} : { model: definition.model },
    ...definition.reasoningEffort === undefined ? {} : { reasoningEffort: definition.reasoningEffort },
    ...definition.maxDepth === undefined ? {} : { maxDepth: definition.maxDepth },
  }
}

/** Mount the real definition registry with one inline stub provider. */
async function mountDefinitions(
  ctx: Context,
  definitions: readonly StubDefinition[],
  options: { complete?: boolean } = {},
): Promise<void> {
  await ctx.plugin(AgentDefinitionsRegistry)
  ctx.agentDefinitions.registerProvider(() => ({
    name: 'stub',
    list: () => Promise.resolve(options.complete === false
      ? { definitions: definitions.map(candidateOf), complete: false }
      : definitions.map(candidateOf)),
    get: (candidate: AgentDefinitionCandidate) => {
      const definition = candidate.locator as StubDefinition
      return Promise.resolve({
        ...candidateOf(definition),
        instructions: definition.instructions,
      })
    },
  }))
}

function definitionsHook(
  definitions: readonly StubDefinition[],
  options: { complete?: boolean } = {},
): (ctx: Context) => Promise<void> {
  return async (ctx: Context) => { await mountDefinitions(ctx, definitions, options) }
}

function toolParameters(ctx: Context): Record<string, unknown> {
  const schema = ctx.tools.schemas().find(entry => entry.name === 'subagent')
  if (schema === undefined) throw new Error('subagent tool is not registered')
  return (schema.parameters as { properties?: Record<string, unknown> }).properties ?? {}
}

let agentCounter = 0

function agentForCwd(cwd: string): Agent {
  const id = SessionId(`agent-definitions-${++agentCounter}`)
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false,
  })
  return {
    ctx: new Context(),
    id,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('the agent catalog must not use agent.inject()') },
    cancel() {},
    runMaintenance: (task: (signal: AbortSignal) => unknown) => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  } as unknown as Agent
}

function openMessageTurn(session: Session, turn = 1): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `turn ${turn}` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

async function fireStep(ctx: Context, agent: Agent, turn: number, step: number): Promise<void> {
  const signal = new AbortController().signal
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn, step, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
  if (decision.kind === 'enter') {
    for (const message of decision.messages) {
      agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
  }
}

async function proposeRejectedStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  const signal = new AbortController().signal
  return await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal },
    () => Promise.resolve({ kind: 'reject' as const }),
  )
}

function publishedCatalogs(agent: Agent): string[] {
  return agent.session.snapshotEvents()
    .filter((event): event is Extract<SessionEvent, { type: 'user/message' }> => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && (event.data.source as { plugin?: unknown }).plugin === AGENT_CATALOG_PLUGIN)
    .map(event => event.data.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join(''))
}

describe('dsh-tool-subagent agent definitions', () => {
  it('omits agent_type when no definition registry is mounted', async () => {
    const ctx = await setup({ provider: 'mock' })
    expect(Object.keys(toolParameters(ctx))).not.toContain('agent_type')
  })

  it('exposes agent_type when the registry is mounted and the provider hosts personas', async () => {
    const ctx = await setup({ provider: 'mock', beforeTool: definitionsHook([REVIEWER]) })
    expect(Object.keys(toolParameters(ctx))).toContain('agent_type')
  })

  it('omits agent_type when the provider cannot host a persona', async () => {
    const ctx = await setup(
      { provider: 'mock', beforeTool: definitionsHook([REVIEWER]) },
      { capabilities: { persona: false } },
    )
    expect(Object.keys(toolParameters(ctx))).not.toContain('agent_type')
  })

  it('rejects a call that selects an agent_type without a mounted registry', async () => {
    const ctx = await setup({ provider: 'mock' })
    const result = await callSubagent(ctx, { description: 'review', prompt: 'review it', agent_type: 'reviewer' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('agent definitions are unavailable')
  })

  it('rejects an unknown agent_type', async () => {
    const ctx = await setup({ provider: 'mock', beforeTool: definitionsHook([REVIEWER]) })
    const result = await callSubagent(ctx, { description: 'review', prompt: 'review it', agent_type: 'missing' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('agent definition "missing" is unknown or no longer available')
  })

  it('applies the selected persona, tool allow-list, and depth cap', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup(
      {
        provider: 'mock',
        maxDepth: 2,
        beforeTool: definitionsHook([{
          ...REVIEWER,
          tools: ['subagent'],
          maxDepth: 0,
        }]),
      },
      { onStart: (request) => { starts.push(request) } },
    )
    const result = await callSubagent(ctx, { description: 'review', prompt: 'review it', agent_type: 'reviewer' })
    expect(result.isError).toBe(false)
    expect(starts).toHaveLength(1)
    expect(starts[0]?.persona).toBe('You are a code reviewer.')
    expect(starts[0]?.toolFilter).toEqual({ allow: ['subagent'] })
    expect(starts[0]?.maxDepth).toBe(0)
  })

  it('keeps configured child defaults when no agent_type is selected', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup(
      {
        provider: 'mock',
        persona: 'Configured persona.',
        toolFilter: { allow: ['subagent'] },
        beforeTool: definitionsHook([REVIEWER]),
      },
      { onStart: (request) => { starts.push(request) } },
    )
    const result = await callSubagent(ctx, { description: 'review', prompt: 'review it' })
    expect(result.isError).toBe(false)
    expect(starts[0]?.persona).toBe('Configured persona.')
    expect(starts[0]?.toolFilter).toEqual({ allow: ['subagent'] })
  })

  it('lets a configured depth cap tighten a definition cap', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup(
      { provider: 'mock', maxDepth: 2, beforeTool: definitionsHook([{ ...REVIEWER, maxDepth: 5 }]) },
      { onStart: (request) => { starts.push(request) } },
    )
    await callSubagent(ctx, { description: 'review', prompt: 'review it', agent_type: 'reviewer' })
    expect(starts[0]?.maxDepth).toBe(2)
  })

  it('rejects a definition that restricts tools when the provider cannot', async () => {
    const ctx = await setup(
      { provider: 'mock', maxDepth: 'provider-managed', beforeTool: definitionsHook([{ ...REVIEWER, tools: ['subagent'] }]) },
      { capabilities: { toolFilter: false } },
    )
    const result = await callSubagent(ctx, { description: 'review', prompt: 'review it', agent_type: 'reviewer' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('has no toolFilter capability')
  })

  it('rejects a definition that caps depth when the provider cannot', async () => {
    const ctx = await setup(
      { provider: 'mock', maxDepth: 'provider-managed', beforeTool: definitionsHook([{ ...REVIEWER, maxDepth: 1 }]) },
      { capabilities: { depthLimit: false } },
    )
    const result = await callSubagent(ctx, { description: 'review', prompt: 'review it', agent_type: 'reviewer' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('has no depthLimit capability')
  })

  it('rejects a definition naming a tool this agent cannot see', async () => {
    const ctx = await setup({ provider: 'mock', beforeTool: definitionsHook([{ ...REVIEWER, tools: ['absent'] }]) })
    const result = await callSubagent(ctx, { description: 'review', prompt: 'review it', agent_type: 'reviewer' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('names tool "absent", which this agent cannot see')
  })

  it('rejects a definition route while model selection is disabled', async () => {
    const ctx = await setup({ provider: 'mock', beforeTool: definitionsHook([{ ...REVIEWER, model: 'child-model' }]) })
    const result = await callSubagent(ctx, { description: 'review', prompt: 'review it', agent_type: 'reviewer' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('declares a child LLM route, but model selection is disabled')
  })

  it('honors a definition route the Session authorizes', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup(
      {
        provider: 'mock',
        withModelSelection: true,
        parentAgentOptions: { provider: 'alpha', model: 'parent-model' },
        beforeTool: definitionsHook([{ ...REVIEWER, model: 'allowed-model' }]),
      },
      { onStart: (request) => { starts.push(request) } },
    )
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([]))
    expect(modelSelectionSetupAgent(ctx)).toBeDefined()
    const result = await callSubagent(ctx, { description: 'review', prompt: 'review it', agent_type: 'reviewer' })
    expect(text(result)).not.toContain('Error')
    expect(result.isError).toBe(false)
    expect(starts[0]?.agentOptions?.model).toBe('allowed-model')
  })

  it('applies a definition reasoning effort to the child route', async () => {
    const ctx = await setup({
      provider: 'mock',
      withModelSelection: true,
      parentAgentOptions: { provider: 'alpha', model: 'parent-model' },
      beforeTool: definitionsHook([{ ...REVIEWER, reasoningEffort: 'low' }]),
    })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([]))
    const result = await callSubagent(ctx, { description: 'review', prompt: 'review it', agent_type: 'reviewer' })
    // The mock route advertises no reasoning efforts, so the route preflight
    // reports the requested effort instead of starting a child.
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('does not support reasoning effort "low"')
  })

  it('rejects a definition route the Session does not authorize', async () => {
    const ctx = await setup({
      provider: 'mock',
      withModelSelection: true,
      parentAgentOptions: { provider: 'alpha', model: 'parent-model' },
      beforeTool: definitionsHook([{ ...REVIEWER, model: 'forbidden-model' }]),
    })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([]))
    const result = await callSubagent(ctx, { description: 'review', prompt: 'review it', agent_type: 'reviewer' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('is not allowed for this Session')
  })
})

describe('dsh-tool-subagent agent catalog', () => {
  it('publishes the catalog once before the first step', async () => {
    const ctx = await setup({ provider: 'mock', agentCatalog: true, beforeTool: definitionsHook([REVIEWER]) })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    await fireStep(ctx, agent, 1, 1)
    const catalogs = publishedCatalogs(agent)
    expect(catalogs).toHaveLength(1)
    expect(catalogs[0]).toContain('- `reviewer`: Reviews a change for correctness and repo conventions.')
    expect(catalogs[0]).toContain('<available_subagents>')
    await fireStep(ctx, agent, 1, 2)
    expect(publishedCatalogs(agent)).toHaveLength(1)
  })

  it('publishes nothing while the registry is absent', async () => {
    const ctx = await setup({ provider: 'mock', agentCatalog: true })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    await fireStep(ctx, agent, 1, 1)
    expect(publishedCatalogs(agent)).toHaveLength(0)
  })

  it('publishes nothing when no definition exists', async () => {
    const ctx = await setup({ provider: 'mock', agentCatalog: true, beforeTool: definitionsHook([]) })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    await fireStep(ctx, agent, 1, 1)
    expect(publishedCatalogs(agent)).toHaveLength(0)
  })

  it('publishes nothing when the catalog is disabled', async () => {
    const ctx = await setup({ provider: 'mock', beforeTool: definitionsHook([REVIEWER]) })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    await fireStep(ctx, agent, 1, 1)
    expect(publishedCatalogs(agent)).toHaveLength(0)
  })

  it('replaces the catalog when membership changes', async () => {
    const definitions: StubDefinition[] = [REVIEWER]
    const ctx = await setup({ provider: 'mock', agentCatalog: true, beforeTool: definitionsHook(definitions) })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    await fireStep(ctx, agent, 1, 1)
    definitions.push({
      name: 'tester',
      description: 'Writes focused tests.',
      instructions: 'You write tests.',
    })
    await fireStep(ctx, agent, 1, 2)
    const catalogs = publishedCatalogs(agent)
    expect(catalogs).toHaveLength(2)
    expect(catalogs[1]).toContain('- `reviewer`: Reviews a change for correctness and repo conventions.')
    expect(catalogs[1]).toContain('- `tester`: Writes focused tests.')
  })

  it('retires the catalog when every definition disappears', async () => {
    const definitions: StubDefinition[] = [REVIEWER]
    const ctx = await setup({ provider: 'mock', agentCatalog: true, beforeTool: definitionsHook(definitions) })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    await fireStep(ctx, agent, 1, 1)
    definitions.splice(0)
    await fireStep(ctx, agent, 1, 2)
    const catalogs = publishedCatalogs(agent)
    expect(catalogs).toHaveLength(2)
    expect(catalogs[1]).toContain('- (none)')
    expect(catalogs[1]).not.toContain('`reviewer`')
  })

  it('keeps the last published catalog when discovery is incomplete', async () => {
    const ctx = await setup({
      provider: 'mock',
      agentCatalog: true,
      beforeTool: definitionsHook([REVIEWER], { complete: false }),
    })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    await fireStep(ctx, agent, 1, 1)
    expect(publishedCatalogs(agent)).toHaveLength(0)
  })

  it('caps each published description', async () => {
    const ctx = await setup({
      provider: 'mock',
      agentCatalog: true,
      catalogDescriptionMaxLength: 12,
      beforeTool: definitionsHook([REVIEWER]),
    })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    await fireStep(ctx, agent, 1, 1)
    expect(publishedCatalogs(agent)[0]).toContain('- `reviewer`: Reviews a...')
  })

  it('rejects an invalid catalogDescriptionMaxLength', async () => {
    await expect(setup({ provider: 'mock', agentCatalog: true, catalogDescriptionMaxLength: 2 }))
      .rejects.toThrow('`catalogDescriptionMaxLength` must be an integer greater than or equal to 3')
  })

  it('passes a rejected step through untouched', async () => {
    const ctx = await setup({ provider: 'mock', agentCatalog: true, beforeTool: definitionsHook([REVIEWER]) })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    const decision = await proposeRejectedStep(ctx, agent)
    expect(decision.kind).toBe('reject')
    expect(publishedCatalogs(agent)).toHaveLength(0)
  })
  it('replaces a pending catalog in place', async () => {
    const ctx = await setup({ provider: 'mock', agentCatalog: true, beforeTool: definitionsHook([REVIEWER]) })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    ctx.on('agent/pre-step', async (_payload, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      return {
        ...decision,
        messages: [
          ...decision.messages,
          createUserMessage({ content: [{ type: 'text', text: 'unrelated' }], source: { kind: 'plugin', plugin: 'other' } }),
          agentCatalogMessage(renderAgentCatalog([])),
        ],
      }
    })
    await fireStep(ctx, agent, 1, 1)
    const catalogs = publishedCatalogs(agent)
    expect(catalogs).toHaveLength(1)
    expect(catalogs[0]).toContain('- `reviewer`:')
  })

  it('removes a pending catalog that repeats the visible one', async () => {
    const ctx = await setup({ provider: 'mock', agentCatalog: true, beforeTool: definitionsHook([REVIEWER]) })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    await fireStep(ctx, agent, 1, 1)
    const identical = renderAgentCatalog(agentCatalogEntries([candidateOf(REVIEWER)], 500))
    ctx.on('agent/pre-step', async (_payload, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      return { ...decision, messages: [...decision.messages, agentCatalogMessage(identical)] }
    })
    await fireStep(ctx, agent, 1, 2)
    expect(publishedCatalogs(agent)).toHaveLength(1)
  })

  it('keeps a pending catalog that already matches', async () => {
    const ctx = await setup({ provider: 'mock', agentCatalog: true, beforeTool: definitionsHook([REVIEWER]) })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    const identical = renderAgentCatalog(agentCatalogEntries([candidateOf(REVIEWER)], 500))
    ctx.on('agent/pre-step', async (_payload, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      return { ...decision, messages: [...decision.messages, agentCatalogMessage(identical)] }
    })
    await fireStep(ctx, agent, 1, 1)
    expect(publishedCatalogs(agent)).toHaveLength(1)
  })

  it('removes a pending catalog when nothing was ever published', async () => {
    const ctx = await setup({ provider: 'mock', agentCatalog: true, beforeTool: definitionsHook([]) })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    ctx.on('agent/pre-step', async (_payload, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      return {
        ...decision,
        messages: [...decision.messages, agentCatalogMessage(renderAgentCatalog([{ name: 'ghost', description: 'Gone.' }]))],
      }
    })
    await fireStep(ctx, agent, 1, 1)
    expect(publishedCatalogs(agent)).toHaveLength(0)
  })

  it('re-establishes the catalog after compaction hides it', async () => {
    const ctx = await setup({ provider: 'mock', agentCatalog: true, beforeTool: definitionsHook([REVIEWER]) })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    await fireStep(ctx, agent, 1, 1)
    const initial = agent.session.snapshotEvents().find(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && (event.data.source as { plugin?: unknown }).plugin === AGENT_CATALOG_PLUGIN)
    if (initial === undefined) throw new Error('expected an initial catalog')
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'compacted history' }],
      source: { kind: 'plugin', plugin: 'compact' },
    }), {
      surfaceOp: { op: 'replace', startSeq: initial.seq, endSeq: initial.seq },
      sourceEventSeqs: [initial.seq],
    })
    await fireStep(ctx, agent, 1, 2)
    expect(publishedCatalogs(agent)).toHaveLength(2)
    expect(publishedCatalogs(agent).at(-1)).toContain('- `reviewer`:')
  })

  it('escapes definition descriptions inside the catalog frame', async () => {
    const ctx = await setup({
      provider: 'mock',
      agentCatalog: true,
      beforeTool: definitionsHook([{ name: 'sneaky', description: 'Uses & <tags> to escape', instructions: 'Body.' }]),
    })
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    await fireStep(ctx, agent, 1, 1)
    expect(publishedCatalogs(agent)[0]).toContain('- `sneaky`: Uses &amp; &lt;tags&gt; to escape')
  })
})

describe('agent catalog helpers', () => {
  it('classifies only plugin sources carrying the catalog id', () => {
    expect(isAgentCatalogSource(null)).toBe(false)
    expect(isAgentCatalogSource('plugin')).toBe(false)
    expect(isAgentCatalogSource({ kind: 'plugin', plugin: 'other' })).toBe(false)
    expect(isAgentCatalogSource({ kind: 'plugin', plugin: AGENT_CATALOG_PLUGIN })).toBe(true)
  })

  it('reports no digest while a published catalog is hidden', () => {
    const agent = agentForCwd(process.cwd())
    openMessageTurn(agent.session)
    const catalog = agentCatalogMessage(renderAgentCatalog([]))
    agent.session.append('user/message', catalog, { surfaceOp: 'append' })
    expect(visibleAgentCatalog(agent).published).toBe(true)
    expect(visibleAgentCatalog(agent).digest).toBeDefined()
    const initial = agent.session.snapshotEvents().find(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && (event.data.source as { plugin?: unknown }).plugin === AGENT_CATALOG_PLUGIN)
    if (initial === undefined) throw new Error('expected a published catalog')
    // A log-only event newer than the catalog forces the backward scan past a
    // non-message event before it reaches the hidden catalog.
    agent.session.append('turn/start', { turn: 2 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'compacted history' }],
      source: { kind: 'plugin', plugin: 'compact' },
    }), {
      surfaceOp: { op: 'replace', startSeq: initial.seq, endSeq: initial.seq },
      sourceEventSeqs: [initial.seq],
    })
    const hidden = visibleAgentCatalog(agent)
    expect(hidden.published).toBe(true)
    expect(hidden.digest).toBeUndefined()
  })
})
