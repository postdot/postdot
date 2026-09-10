import {
    DomainInvariantError,
    requireNonBlank,
    requireSameProject,
    requireTimestamp,
} from './invariants'
import type { Actor, Project, Publication, Timestamp } from './model'

export const taxonomyStates = ['active', 'archived'] as const
export const taxonomyLabelMaximumLength = 120

export type TaxonomyState = (typeof taxonomyStates)[number]

export interface NormalizedTaxonomyLabel {
    readonly name: string
    readonly normalizedName: string
}

/**
 * Normalizes operator-authored taxonomy labels for display and uniqueness.
 * The comparison key intentionally uses the runtime's locale-independent
 * Unicode case mapping rather than the operator's current UI locale.
 */
export function normalizeTaxonomyLabel(value: string, field = 'name'): NormalizedTaxonomyLabel {
    const name = requireNonBlank(value.normalize('NFKC').replace(/\p{White_Space}+/gu, ' '), field)
    if ([...name].length > taxonomyLabelMaximumLength) {
        throw new DomainInvariantError(
            'invalid_input',
            `${field} must not be longer than ${taxonomyLabelMaximumLength} characters`
        )
    }

    const normalizedName = name.toLocaleLowerCase('und')
    if ([...normalizedName].length > taxonomyLabelMaximumLength) {
        throw new DomainInvariantError(
            'invalid_input',
            `${field} must not be longer than ${taxonomyLabelMaximumLength} characters after normalization`
        )
    }

    return { name, normalizedName }
}

export interface ProjectCategory {
    readonly id: string
    readonly name: string
    readonly normalizedName: string
    readonly state: TaxonomyState
    readonly archivedAt: Timestamp | null
    readonly createdAt: Timestamp
    readonly updatedAt: Timestamp
}

export interface ProjectTag {
    readonly id: string
    readonly projectId: string
    readonly name: string
    readonly normalizedName: string
    readonly state: TaxonomyState
    readonly archivedAt: Timestamp | null
    readonly createdAt: Timestamp
    readonly updatedAt: Timestamp
}

export function createProjectCategory(input: {
    readonly id: string
    readonly name: string
    readonly now: Timestamp
}): ProjectCategory {
    const label = normalizeTaxonomyLabel(input.name)
    return {
        id: requireNonBlank(input.id, 'id'),
        ...label,
        state: 'active',
        archivedAt: null,
        createdAt: requireTimestamp(input.now, 'now'),
        updatedAt: requireTimestamp(input.now, 'now'),
    }
}

export function createProjectTag(input: {
    readonly id: string
    readonly project: Project
    readonly name: string
    readonly now: Timestamp
}): ProjectTag {
    const label = normalizeTaxonomyLabel(input.name)
    return {
        id: requireNonBlank(input.id, 'id'),
        projectId: input.project.id,
        ...label,
        state: 'active',
        archivedAt: null,
        createdAt: requireTimestamp(input.now, 'now'),
        updatedAt: requireTimestamp(input.now, 'now'),
    }
}

export function requireProjectPublication(project: Project, publication: Publication): Publication {
    requireSameProject(project.id, publication.projectId, 'publication')
    return publication
}

export function requireProjectActor(project: Project, actor: Actor): Actor {
    requireSameProject(project.id, actor.projectId, 'actor')
    return actor
}
