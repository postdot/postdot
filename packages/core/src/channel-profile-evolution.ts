import { ChannelProfileCompiler, type ChannelProfileDefinition } from './channel-profile'
import {
    hasValidationErrors,
    type ValidationIssue,
    type ValidationResult,
    validationFailure,
    validationSuccess,
} from './validation'

export const channelProfileImpactKinds = ['working_draft', 'pending_target'] as const
export const channelProfileImpactStates = ['compatible', 'review_required'] as const
export const channelProfileChangeKinds = ['schema', 'binding', 'capability', 'execution'] as const

export type ChannelProfileImpactKind = (typeof channelProfileImpactKinds)[number]
export type ChannelProfileImpactState = (typeof channelProfileImpactStates)[number]
export type ChannelProfileChangeKind = (typeof channelProfileChangeKinds)[number]

export interface ChannelProfileChange {
    readonly kind: ChannelProfileChangeKind
    readonly path: string
    readonly code: string
    readonly message: string
}

export interface ChannelProfileImpactCandidate {
    readonly id: string
    readonly kind: ChannelProfileImpactKind
    readonly content: unknown
    readonly deliveryMode?: 'manual' | 'automatic'
}

export interface ChannelProfileImpact {
    readonly id: string
    readonly kind: ChannelProfileImpactKind
    readonly state: ChannelProfileImpactState
    readonly issues: readonly ValidationIssue[]
}

export interface ChannelProfileImpactAssessment {
    readonly currentProfileVersion: number
    readonly proposedProfileVersion: number
    readonly changes: readonly ChannelProfileChange[]
    readonly workingDrafts: readonly ChannelProfileImpact[]
    readonly pendingTargets: readonly ChannelProfileImpact[]
    readonly hasReviewRequired: boolean
}

export interface AssessChannelProfileChangeInput {
    readonly currentProfile: ChannelProfileDefinition
    readonly proposedProfile: ChannelProfileDefinition
    readonly workingDrafts?: readonly ChannelProfileImpactCandidate[]
    readonly pendingTargets?: readonly ChannelProfileImpactCandidate[]
    readonly validateMedia?: (
        candidate: ChannelProfileImpactCandidate,
        profile: ChannelProfileDefinition
    ) => readonly ValidationIssue[]
}

/**
 * Assesses a proposed profile against persisted instances. This deliberately
 * does not attempt general JSON Schema compatibility or mutate any instance.
 */
export function assessChannelProfileChange(
    input: AssessChannelProfileChangeInput
): ValidationResult<ChannelProfileImpactAssessment> {
    const compiler = new ChannelProfileCompiler()
    const currentResult = compiler.compile(input.currentProfile)
    const proposedResult = compiler.compile(input.proposedProfile)

    const profileIssues = [
        ...(currentResult.ok ? [] : currentResult.issues),
        ...(proposedResult.ok ? [] : proposedResult.issues),
    ]
    if (!currentResult.ok || !proposedResult.ok) return validationFailure(profileIssues)

    const changes = compareChannelProfiles(
        currentResult.value.profile,
        proposedResult.value.profile
    )
    const workingDrafts = (input.workingDrafts ?? [])
        .filter(candidate => candidate.kind === 'working_draft')
        .map(candidate =>
            assessCandidate(candidate, proposedResult.value, false, input.validateMedia)
        )
    const pendingTargets = (input.pendingTargets ?? [])
        .filter(candidate => candidate.kind === 'pending_target')
        .map(candidate =>
            assessCandidate(
                candidate,
                proposedResult.value,
                changes.some(change => change.kind === 'execution'),
                input.validateMedia
            )
        )

    return validationSuccess({
        currentProfileVersion: currentResult.value.profile.version,
        proposedProfileVersion: proposedResult.value.profile.version,
        changes,
        workingDrafts,
        pendingTargets,
        hasReviewRequired: [...workingDrafts, ...pendingTargets].some(
            impact => impact.state === 'review_required'
        ),
    })
}

export function compareChannelProfiles(
    current: ChannelProfileDefinition,
    proposed: ChannelProfileDefinition
): readonly ChannelProfileChange[] {
    const changes: ChannelProfileChange[] = []

    if (current.id !== proposed.id) {
        changes.push({
            kind: 'schema',
            path: '/id',
            code: 'profile.identity_changed',
            message: 'A channel profile cannot change its identity',
        })
    }

    if (canonicalJson(current.contentSchema) !== canonicalJson(proposed.contentSchema)) {
        compareSchemas(current.contentSchema, proposed.contentSchema, '/contentSchema', changes)
        if (!changes.some(change => change.kind === 'schema')) {
            changes.push({
                kind: 'schema',
                path: '/contentSchema',
                code: 'profile.schema_changed',
                message: 'The content schema changed',
            })
        }
    }

    compareBindings(current, proposed, changes)
    compareCapabilities(current, proposed, changes)

    if (canonicalJson(current.execution) !== canonicalJson(proposed.execution)) {
        changes.push({
            kind: 'execution',
            path: '/execution',
            code: 'profile.execution_contract_changed',
            message: 'The automatic execution contract changed',
        })
    }

    return deduplicateChanges(changes)
}

function assessCandidate(
    candidate: ChannelProfileImpactCandidate,
    proposed: {
        readonly profile: ChannelProfileDefinition
        readonly validate: (content: unknown) => ValidationResult<Readonly<Record<string, unknown>>>
    },
    executionChanged: boolean,
    validateMedia:
        | ((
              candidate: ChannelProfileImpactCandidate,
              profile: ChannelProfileDefinition
          ) => readonly ValidationIssue[])
        | undefined
): ChannelProfileImpact {
    const issues: ValidationIssue[] = []
    const validation = proposed.validate(candidate.content)
    if (!validation.ok) issues.push(...validation.issues)
    if (validation.ok && validateMedia !== undefined) {
        issues.push(...validateMedia(candidate, proposed.profile))
    }
    if (
        candidate.kind === 'pending_target' &&
        candidate.deliveryMode === 'automatic' &&
        executionChanged
    ) {
        issues.push({
            path: '/execution',
            code: 'profile.execution_contract_changed',
            message:
                'The pending automatic target uses an execution contract changed by the proposed profile',
            severity: 'error',
            source: 'module',
        })
    }

    return {
        id: candidate.id,
        kind: candidate.kind,
        state: hasValidationErrors(issues) ? 'review_required' : 'compatible',
        issues,
    }
}

function compareSchemas(
    current: unknown,
    proposed: unknown,
    path: string,
    changes: ChannelProfileChange[]
): void {
    if (!isRecord(current) || !isRecord(proposed)) {
        changes.push({
            kind: 'schema',
            path,
            code: 'profile.schema_changed',
            message: 'The content schema changed',
        })
        return
    }

    if (current.type !== proposed.type) {
        changes.push({
            kind: 'schema',
            path: `${path}/type`,
            code: 'profile.schema_type_changed',
            message: 'A schema value type changed',
        })
    }

    const currentProperties = isRecord(current.properties) ? current.properties : {}
    const proposedProperties = isRecord(proposed.properties) ? proposed.properties : {}
    const propertyNames = new Set([
        ...Object.keys(currentProperties),
        ...Object.keys(proposedProperties),
    ])
    for (const propertyName of propertyNames) {
        const propertyPath = `${path}/properties/${escapePointerSegment(propertyName)}`
        const previous = currentProperties[propertyName]
        const next = proposedProperties[propertyName]
        if (previous === undefined) {
            changes.push({
                kind: 'schema',
                path: propertyPath,
                code: 'profile.field_added',
                message: `Field ${propertyName} was added`,
            })
            continue
        }
        if (next === undefined) {
            changes.push({
                kind: 'schema',
                path: propertyPath,
                code: 'profile.field_removed',
                message: `Field ${propertyName} was removed`,
            })
            continue
        }
        compareSchemas(previous, next, propertyPath, changes)
    }

    const currentRequired = new Set(asStringArray(current.required))
    const proposedRequired = new Set(asStringArray(proposed.required))
    for (const propertyName of currentRequired) {
        if (proposedRequired.has(propertyName)) continue
        changes.push({
            kind: 'schema',
            path: `${path}/required`,
            code: 'profile.field_no_longer_required',
            message: `Field ${propertyName} is no longer required`,
        })
    }
    for (const propertyName of proposedRequired) {
        if (currentRequired.has(propertyName)) continue
        changes.push({
            kind: 'schema',
            path: `${path}/required`,
            code: 'profile.field_now_required',
            message: `Field ${propertyName} is now required`,
        })
    }

    const ignoredKeys = new Set([
        '$schema',
        '$comment',
        'title',
        'description',
        'default',
        'examples',
        'deprecated',
        'readOnly',
        'writeOnly',
        'type',
        'properties',
        'required',
    ])
    const keys = new Set([...Object.keys(current), ...Object.keys(proposed)])
    for (const key of keys) {
        if (ignoredKeys.has(key)) continue
        if (canonicalJson(current[key]) === canonicalJson(proposed[key])) continue
        changes.push({
            kind: 'schema',
            path: `${path}/${escapePointerSegment(key)}`,
            code: 'profile.schema_constraint_changed',
            message: `Schema constraint ${key} changed`,
        })
    }
}

function compareBindings(
    current: ChannelProfileDefinition,
    proposed: ChannelProfileDefinition,
    changes: ChannelProfileChange[]
): void {
    const currentBindings = new Map(current.fieldBindings.map(binding => [binding.id, binding]))
    const proposedBindings = new Map(proposed.fieldBindings.map(binding => [binding.id, binding]))
    const bindingIds = new Set([...currentBindings.keys(), ...proposedBindings.keys()])

    for (const bindingId of bindingIds) {
        const previous = currentBindings.get(bindingId)
        const next = proposedBindings.get(bindingId)
        const path = `/fieldBindings/${escapePointerSegment(bindingId)}`
        if (previous === undefined) {
            changes.push({
                kind: 'binding',
                path,
                code: 'profile.binding_added',
                message: `Binding ${bindingId} was added`,
            })
        } else if (next === undefined) {
            changes.push({
                kind: 'binding',
                path,
                code: 'profile.binding_removed',
                message: `Binding ${bindingId} was removed`,
            })
        } else if (canonicalJson(previous) !== canonicalJson(next)) {
            changes.push({
                kind: 'binding',
                path,
                code: 'profile.binding_changed',
                message: `Binding ${bindingId} changed`,
            })
        }
    }
}

function compareCapabilities(
    current: ChannelProfileDefinition,
    proposed: ChannelProfileDefinition,
    changes: ChannelProfileChange[]
): void {
    if (current.capabilities.revision !== proposed.capabilities.revision) {
        changes.push({
            kind: 'capability',
            path: '/capabilities/revision',
            code: 'profile.capability_revision_changed',
            message: 'The capability revision changed',
        })
    }

    const currentCapabilities = new Map(
        [...current.capabilities.textFields, ...current.capabilities.mediaFields].map(
            capability => [capability.bindingId, capability]
        )
    )
    const proposedCapabilities = new Map(
        [...proposed.capabilities.textFields, ...proposed.capabilities.mediaFields].map(
            capability => [capability.bindingId, capability]
        )
    )
    const bindingIds = new Set([...currentCapabilities.keys(), ...proposedCapabilities.keys()])

    for (const bindingId of bindingIds) {
        const previous = currentCapabilities.get(bindingId)
        const next = proposedCapabilities.get(bindingId)
        const path = `/capabilities/${escapePointerSegment(bindingId)}`
        if (
            previous === undefined ||
            next === undefined ||
            canonicalJson(previous) !== canonicalJson(next)
        ) {
            changes.push({
                kind: 'capability',
                path,
                code: 'profile.capability_changed',
                message: `Capability for binding ${bindingId} changed`,
            })
        }
    }
}

function deduplicateChanges(changes: readonly ChannelProfileChange[]): ChannelProfileChange[] {
    const seen = new Set<string>()
    return changes.filter(change => {
        const key = `${change.kind}:${change.path}:${change.code}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return JSON.stringify(value)
    }
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(',')}}`
    }
    return JSON.stringify(value)
}

function asStringArray(value: unknown): readonly string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : []
}

function escapePointerSegment(value: string): string {
    return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
