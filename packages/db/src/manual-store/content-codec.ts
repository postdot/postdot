import { createHash } from 'node:crypto'

import {
    DomainInvariantError,
    type ChannelProfileDefinition,
    type SourceContent,
    type TargetContent,
    type ValidationIssue,
} from '@herald/core'

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseProfile(value: string): ChannelProfileDefinition {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new DomainInvariantError(
            'invalid_content',
            'Stored channel profile is not valid JSON'
        )
    }
    if (!isRecord(parsed)) {
        throw new DomainInvariantError('invalid_content', 'Stored channel profile is not an object')
    }
    return parsed as unknown as ChannelProfileDefinition
}

export function parseSourceContent(value: string): SourceContent {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new DomainInvariantError('invalid_content', 'Stored source content is not valid JSON')
    }
    return parsed as SourceContent
}

export function parseJsonObject(value: string, label: string): TargetContent {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new DomainInvariantError('invalid_content', `${label} is not valid JSON`)
    }
    if (!isRecord(parsed)) {
        throw new DomainInvariantError('invalid_content', `${label} must be a JSON object`)
    }
    return parsed
}

export function parseJsonArray(value: string, label: string): readonly Record<string, unknown>[] {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new DomainInvariantError('invalid_content', `${label} is not valid JSON`)
    }
    if (!Array.isArray(parsed) || !parsed.every(isRecord)) {
        throw new DomainInvariantError('invalid_content', `${label} must be an array of objects`)
    }
    return parsed
}

export function parseJsonStringArray(value: string, label: string): readonly string[] {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new DomainInvariantError('invalid_content', `${label} is not valid JSON`)
    }
    if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
        throw new DomainInvariantError('invalid_content', `${label} must be an array of strings`)
    }
    return parsed
}

export function invalidProfileError(issues: readonly ValidationIssue[]): DomainInvariantError {
    return new DomainInvariantError(
        'invalid_content',
        `Channel profile is invalid: ${issues.map(issue => issue.message).join('; ')}`
    )
}

export function invalidSourceContentError(
    issues: readonly ValidationIssue[]
): DomainInvariantError {
    return new DomainInvariantError(
        'invalid_content',
        `Source content is invalid: ${issues.map(issue => issue.message).join('; ')}`
    )
}

export function invalidTargetContentError(
    issues: readonly ValidationIssue[]
): DomainInvariantError {
    return new DomainInvariantError(
        'invalid_content',
        `Publication target content is invalid: ${issues.map(issue => issue.message).join('; ')}`
    )
}

export function contentHash(value: TargetContent): string {
    return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

export function canonicalJson(value: unknown, seen: WeakSet<object> = new WeakSet()): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return JSON.stringify(value)
    }
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
    if (value !== null && typeof value === 'object') {
        if (seen.has(value)) {
            throw new DomainInvariantError('invalid_content', 'Content must not contain cycles')
        }
        seen.add(value)
    }
    if (Array.isArray(value)) {
        const serialized = `[${value.map(item => canonicalJson(item, seen)).join(',')}]`
        seen.delete(value)
        return serialized
    }
    if (isRecord(value)) {
        const serialized = `{${Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`)
            .join(',')}}`
        seen.delete(value)
        return serialized
    }
    throw new DomainInvariantError('invalid_content', 'Content must contain only JSON values')
}

export function requirePositiveRevision(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new DomainInvariantError(
            'invalid_input',
            'expectedRevision must be a positive safe integer'
        )
    }
    return value
}
