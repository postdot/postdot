import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
export const { verifyIdentity, verifyPackage, verifyMetadata } = require('./verify-release.cjs')
export const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const artifactDirectory = resolve(workspace, '.artifacts/npm')
export const packageDirectories = new Map([
    ['@postdot/cli', resolve(workspace, 'cli')],
    ['@postdot/n8n-nodes-postdot', resolve(workspace, 'n8n')],
])
export function changeset(args) {
    execFileSync(
        process.execPath,
        [resolve(workspace, 'node_modules/@changesets/cli/bin.js'), ...args],
        { cwd: workspace, stdio: 'inherit' }
    )
}
export function checkedPlan(filename, { packed = false, artifactRoot = artifactDirectory } = {}) {
    const document = JSON.parse(readFileSync(filename, 'utf8'))
    if (
        document.version !== 1 ||
        !Array.isArray(document.plan) ||
        !document.plan.every(Array.isArray)
    )
        throw new Error('Unsupported Changesets publish-plan format')
    const seen = new Set()
    for (const release of document.plan.flat()) {
        const directory = packageDirectories.get(release.name)
        if (
            !directory ||
            release.kind !== 'publish' ||
            release.access !== 'public' ||
            seen.has(release.name)
        )
            throw new Error('Unexpected release entry')
        seen.add(release.name)
        const manifest = verifyMetadata(directory)
        if (
            release.version !== manifest.version ||
            (packed && release.tag !== manifest.publishConfig.tag)
        )
            throw new Error('Publish plan differs from the canonical manifest')
        if (packed) {
            const path = release.tarball?.path
            if (typeof path !== 'string' || isAbsolute(path))
                throw new Error('Invalid archive path')
            const archive = resolve(artifactRoot, path)
            const child = relative(artifactRoot, archive)
            if (child.startsWith('..') || isAbsolute(child))
                throw new Error('Archive escapes the prepared artifact directory')
            const integrity = `sha256-${createHash('sha256').update(readFileSync(archive)).digest('base64')}`
            if (release.tarball.integrity !== integrity)
                throw new Error('Archive integrity mismatch')
            const metadata = JSON.parse(
                execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' })
            )
            if (
                metadata.name !== release.name ||
                metadata.version !== release.version ||
                metadata.private ||
                metadata.publishConfig?.tag !== 'alpha' ||
                metadata.publishConfig.access !== 'public' ||
                metadata.publishConfig.registry !== 'https://registry.npmjs.org' ||
                !metadata.publishConfig.provenance
            )
                throw new Error('Archive metadata differs from the reviewed release')
        }
    }
    return document
}
export async function registryPackage(name) {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
        signal: AbortSignal.timeout(30_000),
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Registry preflight failed (HTTP ${response.status})`)
    return response.json()
}
