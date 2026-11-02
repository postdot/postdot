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

async function reportOidcExchangeDiagnostics(manifests) {
    const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
    const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    if (!requestUrl || !requestToken) return
    try {
        const tokenUrl = new URL(requestUrl)
        tokenUrl.searchParams.append('audience', 'npm:registry.npmjs.org')
        const tokenResponse = await fetch(tokenUrl, {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${requestToken}`,
            },
            signal: AbortSignal.timeout(15_000),
        })
        if (!tokenResponse.ok) {
            console.error(`OIDC ID token request failed with HTTP ${tokenResponse.status}`)
            return
        }
        const { value: idToken } = await tokenResponse.json()
        const [, payloadSegment] = (idToken ?? '').split('.')
        if (payloadSegment) {
            const claims = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'))
            console.error(
                'OIDC JWT claims:',
                JSON.stringify({
                    repository: claims.repository,
                    repository_visibility: claims.repository_visibility,
                    workflow_ref: claims.workflow_ref,
                    job_workflow_ref: claims.job_workflow_ref,
                    ref: claims.ref,
                    event_name: claims.event_name,
                    environment: claims.environment ?? null,
                })
            )
        }
        for (const manifest of manifests) {
            const exchangeUrl = `https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(manifest.name)}`
            const exchangeResponse = await fetch(exchangeUrl, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${idToken}`,
                },
                signal: AbortSignal.timeout(15_000),
            })
            if (exchangeResponse.ok) {
                console.error(`OIDC token exchange for ${manifest.name}: HTTP 200 OK`)
            } else {
                const body = await exchangeResponse.text()
                console.error(
                    `OIDC token exchange for ${manifest.name}: HTTP ${exchangeResponse.status} — ${body}`
                )
            }
        }
    } catch (diagnosticError) {
        console.error('OIDC diagnostic check failed:', diagnosticError?.message ?? diagnosticError)
    }
}

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
} catch (error) {
    await reportOidcExchangeDiagnostics(manifests)
    throw error
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
