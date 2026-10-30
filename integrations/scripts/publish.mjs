import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
    artifactDirectory,
    changeset,
    checkedPlan,
    packageDirectories,
    registryPackage,
    verifyPackage,
} from './release-files.mjs'

const manifests = [...packageDirectories.values()].map(directory => verifyPackage(directory))
const planFile = resolve(artifactDirectory, 'publish-plan.json')
const document = checkedPlan(planFile, { packed: true })
const registeredCli = await registryPackage('@postdot/cli')
const cliReady =
    registeredCli &&
    Object.keys(registeredCli.versions ?? {}).some(version => version !== '0.0.0-stage')
const ready = cliReady
    ? document
    : {
          ...document,
          plan: document.plan
              .map(group => group.filter(release => release.name !== '@postdot/cli'))
              .filter(group => group.length),
      }
if (!cliReady)
    console.log(
        'CLI awaits initial staging, approval and npm trust setup; n8n releases remain independent'
    )
// Only the set of eligible releases changes. Their verified archive bytes, tags
// and integrity values are preserved; restore the complete review plan afterward.
try {
    writeFileSync(planFile, `${JSON.stringify(ready, null, 2)}\n`)
    changeset(['publish', '--from-pack-dir', artifactDirectory])
} finally {
    writeFileSync(planFile, `${JSON.stringify(document, null, 2)}\n`)
}
// Staged approval happens on npm, outside Changesets publish. Once both versions
// exist publicly, Changesets can record any missing package-qualified tags.
const published = await Promise.all(
    manifests.map(async manifest => {
        const metadata = await registryPackage(manifest.name)
        return Boolean(metadata?.versions?.[manifest.version])
    })
)
if (published.every(Boolean)) {
    changeset(['git-tag'])
    execFileSync(
        'git',
        [
            'push',
            'origin',
            ...manifests.map(manifest => `refs/tags/${manifest.name}@${manifest.version}`),
        ],
        { stdio: 'inherit' }
    )
}
