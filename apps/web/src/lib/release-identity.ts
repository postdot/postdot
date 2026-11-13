export interface ReleaseIdentity {
    readonly version: string | null
    readonly revision: string | null
}

export function readReleaseIdentity(value: unknown): ReleaseIdentity {
    if (!value || typeof value !== 'object') throw new Error('Invalid build identity')
    const { version, revision } = value as Record<string, unknown>
    if (
        !(
            version === null ||
            (typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
        ) ||
        !(revision === null || (typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision)))
    )
        throw new Error('Invalid build identity')
    return { version, revision }
}

export function readStudioBuildIdentity(
    environment: Record<string, string | undefined>
): ReleaseIdentity {
    return readReleaseIdentity({
        version: environment.POSTDOT_VERSION || null,
        revision: environment.POSTDOT_REVISION || null,
    })
}

export function compareReleaseIdentities(
    studio: ReleaseIdentity,
    api: ReleaseIdentity
): 'match' | 'mismatch' | 'unknown' {
    for (const field of ['version', 'revision'] as const)
        if (studio[field] !== null && api[field] !== null && studio[field] !== api[field])
            return 'mismatch'
    return studio.version !== null &&
        studio.revision !== null &&
        api.version !== null &&
        api.revision !== null
        ? 'match'
        : 'unknown'
}
