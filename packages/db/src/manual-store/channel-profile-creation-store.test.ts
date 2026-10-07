import { expect, test } from 'bun:test'

import { ChannelProfileValidationError, type ChannelProfileDefinition } from '@herald/core'

import { closeDatabase, createDatabase } from '../client'
import { createManualStore } from '../manual-store'
import { runMigrations } from '../migrations'

function customBase(): Record<string, unknown> {
    return {
        id: 'custom-creation',
        version: 1,
        origin: 'custom',
        contentSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: { body: { type: 'string', minLength: 1, maxLength: 1000 } },
            required: ['body'],
            additionalProperties: false,
        },
        fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
        capabilities: {
            revision: 'herald-custom-v1',
            textFields: [
                { bindingId: 'body', acceptedSourceFormats: ['plain_text'], maxLength: 1000 },
            ],
            mediaFields: [],
            relations: [],
        },
        execution: { kind: 'manual' },
    }
}

test('custom creation derives fingerprints, replaces legacy values and preserves identity', () => {
    const database = createDatabase(':memory:')
    try {
        runMigrations(database)
        const store = createManualStore(database, { now: () => 1_800_000_000_000 })
        const { project } = store.createProject({
            name: 'Creation fingerprints',
            subjectId: 'operator',
            displayName: 'Operator',
        })
        const input = { projectId: project.id, subjectId: 'operator' }

        const channel = store.createChannel({
            ...input,
            name: 'Derived',
            profile: customBase() as unknown as ChannelProfileDefinition,
        })!
        const stored = store.getChannelProfileState(project.id, channel.id, 'operator')!.active
            .profile as unknown as Record<string, unknown>
        expect(stored.id).toBe('custom-creation')
        expect(stored.version).toBe(1)
        expect(stored.origin).toBe('custom')
        expect(stored.schemaHash).toMatch(/^sha256:[a-f0-9]{64}$/)
        expect(stored.profileHash).toMatch(/^sha256:[a-f0-9]{64}$/)

        const legacy = {
            ...customBase(),
            id: 'custom-legacy',
            profileHash: 'sha256:operator-chosen-abc',
            schemaHash: 'sha256:operator-chosen-schema',
        }
        const legacyChannel = store.createChannel({
            ...input,
            name: 'Legacy replaced',
            profile: legacy as unknown as ChannelProfileDefinition,
        })!
        const legacyStored = store.getChannelProfileState(project.id, legacyChannel.id, 'operator')!
            .active.profile as unknown as Record<string, unknown>
        expect(legacyStored.id).toBe('custom-legacy')
        expect(legacyStored.profileHash).not.toBe('sha256:operator-chosen-abc')
        expect(legacyStored.schemaHash).not.toBe('sha256:operator-chosen-schema')
        expect(legacyStored.profileHash).toMatch(/^sha256:[a-f0-9]{64}$/)

        const derivedAgain = store.createChannel({
            ...input,
            name: 'Derived again',
            profile: customBase() as unknown as ChannelProfileDefinition,
        })!
        const againStored = store.getChannelProfileState(project.id, derivedAgain.id, 'operator')!
            .active.profile as unknown as Record<string, unknown>
        expect(againStored.schemaHash).toBe(stored.schemaHash)
        expect(againStored.profileHash).toBe(stored.profileHash)
    } finally {
        closeDatabase(database)
    }
})

test('custom creation reuses templates with altered schemas and keeps built-ins intact', () => {
    const database = createDatabase(':memory:')
    try {
        runMigrations(database)
        const store = createManualStore(database, { now: () => 1_800_000_000_000 })
        const { project } = store.createProject({
            name: 'Creation reuse',
            subjectId: 'operator',
            displayName: 'Operator',
        })
        const input = { projectId: project.id, subjectId: 'operator' }

        const first = store.createChannel({
            ...input,
            name: 'First',
            profile: customBase() as unknown as ChannelProfileDefinition,
        })!
        const second = store.createChannel({
            ...input,
            name: 'Second identical',
            profile: customBase() as unknown as ChannelProfileDefinition,
        })!
        expect(second.id).not.toBe(first.id)

        const altered = customBase()
        ;(
            altered.contentSchema as { properties: { body: { maxLength: number } } }
        ).properties.body.maxLength = 900
        const third = store.createChannel({
            ...input,
            name: 'Third altered',
            profile: altered as unknown as ChannelProfileDefinition,
        })!
        const firstStored = store.getChannelProfileState(project.id, first.id, 'operator')!.active
            .profile as unknown as Record<string, unknown>
        const thirdStored = store.getChannelProfileState(project.id, third.id, 'operator')!.active
            .profile as unknown as Record<string, unknown>
        expect(thirdStored.schemaHash).not.toBe(firstStored.schemaHash)
        expect(thirdStored.profileHash).not.toBe(firstStored.profileHash)

        const builtin = store.createChannel({ ...input, name: 'Built-in default' })!
        const builtinStored = store.getChannelProfileState(project.id, builtin.id, 'operator')!
            .active.profile as unknown as Record<string, unknown>
        expect(builtinStored.origin).toBe('built_in')
        expect(builtinStored.id).toBe('manual-message')
    } finally {
        closeDatabase(database)
    }
})

test('custom creation preserves normalized issues and creates nothing on refusal', () => {
    const database = createDatabase(':memory:')
    try {
        runMigrations(database)
        const store = createManualStore(database, { now: () => 1_800_000_000_000 })
        const { project } = store.createProject({
            name: 'Creation refusal',
            subjectId: 'operator',
            displayName: 'Operator',
        })
        const input = { projectId: project.id, subjectId: 'operator' }
        const count = () => store.listChannels(project.id, 'operator')!.length
        expect(count()).toBe(0)

        const malformed = customBase()
        malformed.capabilities = null
        try {
            store.createChannel({
                ...input,
                name: 'Bad capabilities',
                profile: malformed as unknown as ChannelProfileDefinition,
            })
            expect.unreachable()
        } catch (error) {
            expect(error).toBeInstanceOf(ChannelProfileValidationError)
            const issues = (error as ChannelProfileValidationError).issues
            expect(issues).toContainEqual(
                expect.objectContaining({ path: '/capabilities', code: 'profile.object_required' })
            )
        }
        expect(count()).toBe(0)

        const semantic = customBase()
        ;(
            semantic.capabilities as { textFields: Array<{ bindingId: string }> }
        ).textFields[0]!.bindingId = 'FAKE_SENTINEL_XYZ'
        try {
            store.createChannel({
                ...input,
                name: 'Bad binding',
                profile: semantic as unknown as ChannelProfileDefinition,
            })
            expect.unreachable()
        } catch (error) {
            expect(error).toBeInstanceOf(ChannelProfileValidationError)
            expect((error as ChannelProfileValidationError).issues).toContainEqual(
                expect.objectContaining({
                    path: '/capabilities/textFields/0/bindingId',
                    code: 'capability.binding_missing',
                })
            )
        }
        expect(count()).toBe(0)

        const control = store.createChannel({
            ...input,
            name: 'Control',
            profile: customBase() as unknown as ChannelProfileDefinition,
        })!
        expect(control.id).toBeDefined()
        expect(count()).toBe(1)
    } finally {
        closeDatabase(database)
    }
})

test('channel lists summarize the active execution without exposing its configuration', () => {
    const database = createDatabase(':memory:')
    try {
        runMigrations(database)
        const store = createManualStore(database, { now: () => 1_800_000_000_000 })
        const { project } = store.createProject({
            name: 'Readiness',
            subjectId: 'operator',
            displayName: 'Operator',
        })
        const input = { projectId: project.id, subjectId: 'operator' }
        const channel = store.createChannel({
            ...input,
            name: 'Custom manual',
            profile: customBase() as unknown as ChannelProfileDefinition,
        })!
        const current = () =>
            store.listChannels(project.id, 'operator')!.find(item => item.id === channel.id)!
        expect(current().execution).toEqual({ kind: 'manual' })
        expect(store.listChannels(project.id, 'outsider')).toBeNull()
        const nextProfile = {
            ...customBase(),
            execution: {
                kind: 'declarative_http',
                contractId: 'custom-webhook',
                revision: 'v1',
                mode: 'herald_webhook',
            },
        } as unknown as ChannelProfileDefinition
        const draft = store.createChannelProfileDraft({
            ...input,
            channelId: channel.id,
            profile: nextProfile,
        })!
        expect(current().execution).toEqual({ kind: 'manual' })
        expect(current().profileVersionId).toBe(channel.profileVersionId)
        const activated = store.activateChannelProfile({
            ...input,
            channelId: channel.id,
            profileVersionId: draft.id,
            expectedRevision: channel.revision,
        })!
        expect(activated).not.toBeNull()
        expect(current().profileVersionId).toBe(draft.id)
        expect(current().execution).toEqual({ kind: 'declarative_http' })
        expect(JSON.stringify(current())).not.toContain('herald_webhook')
        expect(JSON.stringify(current())).not.toContain('profileJson')
        const native = store.createChannel({
            ...input,
            name: 'Custom native',
            profile: {
                ...customBase(),
                id: 'custom-native',
                execution: { kind: 'built_in', contractId: 'devto', revision: 'v1' },
            } as unknown as ChannelProfileDefinition,
        })!
        expect(
            store.listChannels(project.id, 'operator')!.find(item => item.id === native.id)!
                .execution
        ).toEqual({ kind: 'built_in', contractId: 'devto' })
    } finally {
        closeDatabase(database)
    }
})
