import { existsSync, readFileSync } from 'node:fs'

export interface ReleaseInfo {
    readonly version: string | null
    readonly revision: string | null
}

// Packaged beside postdot.js; runtime environment variables cannot change identity.
export function readReleaseInfo(
    filename: URL = new URL('./release.json', import.meta.url)
): ReleaseInfo {
    if (!existsSync(filename)) return { version: null, revision: null }
    const value: unknown = JSON.parse(readFileSync(filename, 'utf8'))
    if (!value || typeof value !== 'object') throw new Error('Invalid packaged release metadata')
    const { version, revision } = value as Record<string, unknown>
    if (
        !(
            version === null ||
            (typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
        ) ||
        !(revision === null || (typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision)))
    ) {
        throw new Error('Invalid packaged release metadata')
    }
    return { version, revision }
}

export function printReleaseVersion(args: readonly string[]): boolean {
    if (args[0] !== '--version' && args[0] !== '-v') return false
    if (args.length > 2 || (args.length === 2 && args[1] !== '--json'))
        throw new Error('Use --version [--json]')
    const info = readReleaseInfo()
    console.log(
        args[1] === '--json'
            ? JSON.stringify(info)
            : `Postdot ${info.version ?? 'unversioned'} (${info.revision ?? 'unknown revision'})`
    )
    return true
}
