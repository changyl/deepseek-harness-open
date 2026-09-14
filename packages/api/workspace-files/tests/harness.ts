/**
 * Shared fixture: a real local backend over a temp workspace beside a sibling
 * directory outside it, and a sandbox policy whose only job is naming the root.
 *
 * The real backend, not a mocked `ctx.fs`, because the gates under test are
 * only meaningful against a real filesystem: a symlink that leaves the
 * workspace, a file whose byte size exceeds the cap, and bytes that are not
 * text. A fake provider would let a string-prefix containment check pass this
 * file, which is exactly the defect the gate exists to prevent.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceFiles, type Config, type WorkspaceFileScope } from '../src/index.ts'

/** Build the header-derived scope that direct service calls receive after Typert lookup. */
function fileScope(workspaceRoot: string): WorkspaceFileScope {
  return { sessionId: SessionId('s-test'), workspaceRoot }
}

export const signal = (): AbortSignal => new AbortController().signal

/** The sandbox modes the harness's fake policy can resolve. */
export type HarnessMode = 'read-only' | 'workspace-write'

/** One temp workspace and the context serving it. */
export interface Harness {
  readonly workspace: string
  readonly outside: string
  readonly ctx: Context
  readonly scope: WorkspaceFileScope
  /**
   * Mode the fake policy resolves for every call. Reads ignore it; a write must
   * refuse under `read-only`, which is the only way to exercise that gate from a
   * direct service call.
   */
  mode: HarnessMode
  /**
   * Whether the fake session registry still holds {@link Harness.scope}'s
   * Session. Dropping it models a Session that has gone cold, where the policy
   * cannot be resolved and a write has to fail closed.
   */
  live: boolean
  /** The session objects the fake policy was handed, in call order. */
  readonly policySessions: unknown[]
  /**
   * The service under test, at the given caps. One per test: the service key is
   * global to the Context, so a second call with caps is a defect in the test.
   */
  endpoint(caps?: Partial<Config>): WorkspaceFiles
  dispose(): Promise<void>
}

/**
 * Create the workspace, its outside sibling, and a context with the local
 * backend rooted at the workspace.
 * @param prefix - temp directory prefix naming the suite.
 * @returns the harness; dispose it in `afterEach`.
 */
export async function openWorkspace(prefix: string): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  await mkdir(workspace, { recursive: true })
  await mkdir(outside, { recursive: true })
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalFileSystem, { cwd: workspace })
  const state = {
    mode: 'workspace-write' as HarnessMode,
    live: true,
    policySessions: [] as unknown[],
  }
  // The Session the scope names, present only while `live`; a write resolves its
  // policy from exactly this object, so the assertion surface is the identity.
  const session = { id: 's-test', header: { cwd: workspace } }
  ctx.provide('sessions', {
    get: (id: string) => state.live && id === 's-test' ? session : undefined,
  } as never)
  ctx.provide('sandboxPolicy', {
    workspaceRoot: workspace,
    resolve: (request?: { session?: unknown }) => {
      if (request?.session !== undefined) state.policySessions.push(request.session)
      return { mode: state.mode, workspaceRoot: workspace }
    },
  } as never)
  let service: WorkspaceFiles | undefined
  return {
    workspace,
    outside,
    ctx,
    scope: fileScope(workspace),
    get mode() { return state.mode },
    set mode(mode: HarnessMode) { state.mode = mode },
    get live() { return state.live },
    set live(live: boolean) { state.live = live },
    policySessions: state.policySessions,
    endpoint: (caps) => {
      if (service !== undefined) {
        if (caps !== undefined) throw new Error('the harness serves one WorkspaceFiles per test; hoist the endpoint')
        return service
      }
      service = new WorkspaceFiles(ctx, {
        maxBytes: caps?.maxBytes ?? 1024 * 1024,
        maxFileBytes: caps?.maxFileBytes ?? 1024 * 1024,
        maxLines: caps?.maxLines ?? 5000,
        maxEntries: caps?.maxEntries ?? 2000,
      })
      return service
    },
    dispose: async () => {
      await fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/**
 * Await an operation expected to fail with a Remote error.
 * @param operation - the call under test.
 * @returns the Remote failure's code and details.
 */
export async function failureOf(operation: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await operation
  } catch (error: unknown) {
    const failure = remoteErrorOf(error)
    // A non-Remote throw is a defect in the service, not an expected outcome.
    if (failure === undefined) throw error
    return { code: failure.code, details: failure.details }
  }
  throw new Error('expected the operation to fail')
}
