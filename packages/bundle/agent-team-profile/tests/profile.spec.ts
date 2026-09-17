/** The profile must carry one parseable, explicit Team layer over the service dsh-base mounts. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('Agent Teams profile bundle', () => {
  it('declares a parseable layer with the Team tools and the controls they replace', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      publishConfig?: { access?: string }
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig?.access).toBe('public')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-tool-agent-team': 'workspace:^',
    })

    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    const patches = parsed as {
      id?: string
      disabled?: boolean
      config?: Record<string, unknown>
      insert?: { id?: string; name?: string; config?: Record<string, unknown> }[]
    }[]
    expect(patches.find(patch => patch.id === 'tool-subagent-control')).toMatchObject({ disabled: true })
    expect(patches.find(patch => patch.id === 'tool-subagent-list-agents')).toMatchObject({ disabled: true })
    expect(patches.find(patch => patch.id === 'tool-subagent')?.config).toMatchObject({ backgroundMode: 'one-shot' })
    expect(patches.find(patch => patch.id === 'tool-subagent-fork')?.config).toMatchObject({ backgroundMode: 'one-shot' })
    const inserted = patches.flatMap(patch => patch.insert ?? [])
    // The service row lives in dsh-base; this layer must not repeat it, or the
    // composition would carry the same plugin id twice.
    expect(inserted.find(entry => entry.id === 'agent-team')).toBeUndefined()
    expect(inserted.find(entry => entry.id === 'tool-agent-team')).toMatchObject({
      name: '@deepseek-ai/dsh-tool-agent-team',
      config: { freshProvider: 'spawn', forkProvider: 'fork' },
    })
  })
})
