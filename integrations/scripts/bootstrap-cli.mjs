import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
    artifactDirectory,
    checkedPlan,
    packageDirectories,
    registryPackage,
    verifyPackage,
    workspace,
} from './release-files.mjs'

if (process.env.POSTDOT_NPM_RELEASE_MODE !== 'bootstrap-cli')
    throw new Error('Explicit bootstrap-cli dispatch required')
const manifest = verifyPackage(packageDirectories.get('@postdot/cli'))
if (
    readdirSync(resolve(workspace, '.changeset')).some(
        file => file.endsWith('.md') && file !== 'README.md'
    )
)
    throw new Error('Apply the Changesets version plan before bootstrapping a candidate release')
const plan = checkedPlan(resolve(artifactDirectory, 'publish-plan.json'), { packed: true })
const release = plan.plan
    .flat()
    .find(item => item.name === manifest.name && item.version === manifest.version)
if (!release) throw new Error('The candidate CLI archive is missing')
if (await registryPackage(manifest.name))
    throw new Error(
        'The CLI package already exists; inspect pending stages or use OIDC instead of bootstrapping again'
    )
console.log(
    `Staging ${manifest.name}@${manifest.version} on alpha; approval and npm trust setup remain manual`
)
execFileSync(
    'npm',
    [
        'stage',
        'publish',
        resolve(artifactDirectory, release.tarball.path),
        '--tag',
        'alpha',
        '--access',
        'public',
        '--provenance',
        '--registry',
        'https://registry.npmjs.org',
    ],
    { stdio: 'inherit' }
)
