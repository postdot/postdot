import { describe, expect, test } from 'bun:test'

import {
    assessChannelProfileChange,
    jsonSchema202012Dialect,
    type ChannelProfileDefinition,
} from './index'

function createProfile(
    version: number,
    options: {
        readonly maxLength?: number
        readonly execution?: ChannelProfileDefinition['execution']
    } = {}
): ChannelProfileDefinition {
    const maxLength = options.maxLength ?? 500

    return {
        id: 'evolution-test',
        version,
        profileHash: `sha256:evolution-profile-v${version}`,
        schemaHash: `sha256:evolution-schema-v${version}`,
        origin: 'custom',
        contentSchema: {
            $schema: jsonSchema202012Dialect,
            type: 'object',
            properties: {
                body: { type: 'string', minLength: 1, maxLength },
            },
            required: ['body'],
            additionalProperties: false,
        },
        fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
        capabilities: {
            revision: `evolution-capability-v${version}`,
            textFields: [
                {
                    bindingId: 'body',
                    acceptedSourceFormats: ['plain_text'],
                    minLength: 1,
                    maxLength,
                },
            ],
            mediaFields: [],
            relations: [],
        },
        execution: options.execution ?? { kind: 'manual' },
    }
}

describe('channel profile evolution', () => {
    test('assesses actual drafts and targets instead of relying on abstract compatibility', () => {
        const result = assessChannelProfileChange({
            currentProfile: createProfile(1),
            proposedProfile: createProfile(2, { maxLength: 300 }),
            workingDrafts: [
                {
                    id: 'draft-compatible',
                    kind: 'working_draft',
                    content: { body: 'x'.repeat(280) },
                },
                {
                    id: 'draft-review',
                    kind: 'working_draft',
                    content: { body: 'x'.repeat(350) },
                },
            ],
            pendingTargets: [
                {
                    id: 'target-compatible',
                    kind: 'pending_target',
                    content: { body: 'x'.repeat(280) },
                    deliveryMode: 'automatic',
                },
            ],
        })

        expect(result.ok).toBe(true)
        if (!result.ok) return

        expect(result.value.changes).toContainEqual(
            expect.objectContaining({ kind: 'schema', code: 'profile.schema_constraint_changed' })
        )
        expect(result.value.workingDrafts).toEqual([
            expect.objectContaining({ id: 'draft-compatible', state: 'compatible', issues: [] }),
            expect.objectContaining({ id: 'draft-review', state: 'review_required' }),
        ])
        expect(result.value.pendingTargets).toEqual([
            expect.objectContaining({ id: 'target-compatible', state: 'compatible', issues: [] }),
        ])
        expect(result.value.hasReviewRequired).toBe(true)
    })

    test('requires review when an automatic execution contract changes', () => {
        const result = assessChannelProfileChange({
            currentProfile: createProfile(1),
            proposedProfile: createProfile(2, {
                execution: {
                    kind: 'declarative_http',
                    contractId: 'custom-endpoint',
                    revision: 'v2',
                },
            }),
            pendingTargets: [
                {
                    id: 'target-1',
                    kind: 'pending_target',
                    content: { body: 'still valid' },
                    deliveryMode: 'automatic',
                },
            ],
        })

        expect(result.ok).toBe(true)
        if (!result.ok) return

        expect(result.value.changes).toContainEqual(expect.objectContaining({ kind: 'execution' }))
        expect(result.value.pendingTargets[0]).toEqual(
            expect.objectContaining({
                state: 'review_required',
                issues: [expect.objectContaining({ code: 'profile.execution_contract_changed' })],
            })
        )
    })

    test('includes deterministic module or media issues only for structurally valid content', () => {
        const result = assessChannelProfileChange({
            currentProfile: createProfile(1),
            proposedProfile: createProfile(2),
            workingDrafts: [
                {
                    id: 'valid-draft',
                    kind: 'working_draft',
                    content: { body: 'valid' },
                },
                {
                    id: 'invalid-draft',
                    kind: 'working_draft',
                    content: { body: 42 },
                },
            ],
            validateMedia: candidate =>
                candidate.id === 'valid-draft'
                    ? [
                          {
                              path: '/media',
                              code: 'media.unavailable',
                              message: 'The media representation is unavailable',
                              severity: 'error',
                              source: 'capability',
                          },
                      ]
                    : [],
        })

        expect(result.ok).toBe(true)
        if (!result.ok) return

        expect(result.value.workingDrafts).toEqual([
            expect.objectContaining({
                id: 'valid-draft',
                state: 'review_required',
                issues: [expect.objectContaining({ code: 'media.unavailable' })],
            }),
            expect.objectContaining({
                id: 'invalid-draft',
                state: 'review_required',
                issues: [expect.objectContaining({ code: 'schema.type' })],
            }),
        ])
    })
})
