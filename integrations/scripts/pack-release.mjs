import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
    artifactDirectory,
    changeset,
    checkedPlan,
    packageDirectories,
    verifyMetadata,
    workspace,
} from './release-files.mjs'

const planFile = resolve(workspace, '.artifacts/publish-plan.json')
mkdirSync(resolve(workspace, '.artifacts'), { recursive: true })
rmSync(artifactDirectory, { recursive: true, force: true })
changeset(['publish-plan', '--output', planFile])
const plan = checkedPlan(planFile)
// Changesets defaults initial prereleases to latest. Our public manifests are
// authoritative for the reviewed dist-tag, including the first publication.
for (const release of plan.plan.flat())
    release.tag = verifyMetadata(packageDirectories.get(release.name)).publishConfig.tag
writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`)
changeset(['pack', '--from-publish-plan', planFile, '--out-dir', artifactDirectory])
checkedPlan(resolve(artifactDirectory, 'publish-plan.json'), { packed: true })
console.log(`Prepared ${plan.plan.flat().length} release archive(s); no packages published`)
