import { createHash } from 'node:crypto'

import { fingerprintChannelProfile, type ChannelProfileDefinition } from '@postdot/core'

import { invalidProfileError } from './content-codec'

/**
 * Derive server-owned fingerprints for a newly created custom profile while
 * preserving the declared identity, origin and version. Built-in profiles and
 * already stored definitions are untouched; supplied fingerprints (including
 * legacy symbolic or arbitrary values, or none at all) are always replaced.
 * Runs before compilation and persistence so both observe derived values.
 */
export function normalizeCreationProfile(
    profile: ChannelProfileDefinition
): ChannelProfileDefinition {
    if (profile.origin !== 'custom') return profile

    try {
        return fingerprintChannelProfile(
            {
                ...profile,
                profileHash: '',
                schemaHash: '',
            },
            value => `sha256:${createHash('sha256').update(value).digest('hex')}`
        )
    } catch {
        throw invalidProfileError([
            {
                path: '',
                code: 'profile.invalid_json_value',
                message: 'Channel profile must contain only JSON values',
                severity: 'error',
                source: 'domain',
            },
        ])
    }
}
