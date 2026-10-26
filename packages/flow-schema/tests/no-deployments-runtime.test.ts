/**
 * `@botmesh/flow-schema` is the flow definition; `@botmesh/deployments` only stores what it
 * publishes. flow-schema must not depend on deployments at runtime: its deploy helpers take
 * any registry with a compatible `publish()` (a `DeploymentRegistry` fits structurally).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeploymentRegistry, MemoryDeploymentStore } from '@botmesh/deployments'
import { publishFlow, type FlowDocument } from '../src/index.js'

const root = join(__dirname, '..')

describe('flow-schema without a runtime dependency on deployments', () => {
  it('package.json lists @botmesh/deployments only as a dev dependency', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    expect(pkg.dependencies?.['@botmesh/deployments']).toBeUndefined()
    expect(pkg.devDependencies?.['@botmesh/deployments']).toBeDefined()
  })

  it('no source file imports @botmesh/deployments', () => {
    for (const file of readdirSync(join(root, 'src'))) {
      if (!file.endsWith('.ts')) continue
      expect(readFileSync(join(root, 'src', file), 'utf8'), file).not.toMatch(/from '@botmesh\/deployments'/)
    }
  })

  it('publishFlow still works with a DeploymentRegistry', async () => {
    const registry = new DeploymentRegistry(new MemoryDeploymentStore())
    const doc: FlowDocument = { version: 2, id: 'f', trigger: 'hola', steps: [{ kind: 'say', text: 'hi' }] }
    const deployment = await publishFlow(registry, 't', 'b', doc)
    expect(deployment.artifact).toBe(JSON.stringify(doc))
  })
})
