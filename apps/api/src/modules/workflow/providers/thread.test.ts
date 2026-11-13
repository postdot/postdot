import { expect, it } from 'bun:test'

import { ChannelProfileCompiler } from '@postdot/core'
import {
    createManualStore,
    createPublicationThreadStore,
    createWorkflowStore,
    type PublisherExecutionTarget,
} from '@postdot/db'
import {
    closeTestDatabase,
    openTestDatabase,
    seedTestWorkspace,
    workspaceOf,
} from '@postdot/db/testing'
import {
    isXPostTextValid,
    xThreadChannelProfile,
    xChannelProfileValidationAdapter,
} from '@postdot/x'

import type { BuiltInProviderAdapter, BuiltInProviderExecutionInput } from './registry'
import { withThreadExecution } from './thread'

const now = 1_800_000_000_000

async function fixture() {
    const database = (await openTestDatabase()).database
    const manual = createManualStore(database, {
        validateThreadReceipt: ({ receipt }) => /^\d+$/.test(receipt.externalId),
        now: () => now,
        profileCompiler: new ChannelProfileCompiler({
            validationAdapters: [xChannelProfileValidationAdapter],
        }),
    })
    const project = (
        await manual.createProject({
            workspaceId: await seedTestWorkspace(database),
            name: 'Thread',
            subjectId: 'editor',
            displayName: 'Editor',
        })
    ).project
    const channel = (await manual.createChannel({
        projectId: project.id,
        subjectId: 'editor',
        name: 'X',
        profile: xThreadChannelProfile,
    }))!
    await database.sql
        .statement('insert into publishers(id,workspace_id,channel_id,kind) values (?,?,?,?)')
        .run('publisher', await workspaceOf(database, project.id), channel.id, 'x')
    const created = (await manual.createPost({
        projectId: project.id,
        subjectId: 'editor',
        sourceContent: { body: { text: 'Root', format: 'plain_text' }, media: [] },
        publications: [
            {
                channelId: channel.id,
                deliveryMode: 'automatic',
                scheduledAt: now,
                targetContent: {
                    text: 'Root',
                    media: [],
                    thread: [{ text: 'Second' }, { text: 'Third' }],
                },
            },
        ],
    }))!
    const publication = created.publications[0]!
    const workflow = createWorkflowStore(database)
    const actorId = (await workflow.ensureSystemActor(project.id, now))!
    const job = (await workflow.claimNextDueJob({
        actorId,
        claimToken: 'claim',
        now,
        leaseExpiresAt: now + 60_000,
    }))!
    expect(await workflow.startExternalEffect(job.id, 'claim', now)).toBe(true)
    const execution = (await database.sql
        .statement<{ id: string; content: string }, [string]>(
            'select id, content_json as content from publication_execution_revisions where job_id = ?'
        )
        .get(job.id))!
    const store = createPublicationThreadStore(database)
    const target: PublisherExecutionTarget = {
        jobId: job.id,
        projectId: project.id,
        publicationId: publication.id,
        scheduledAt: now,
        executionRevisionId: execution.id,
        profileVersionId: channel.profileVersionId,
        mediaReferenceCount: 0,
        profile: xThreadChannelProfile,
        content: JSON.parse(execution.content),
        publisherId: 'publisher',
        channelId: channel.id,
        channelName: 'X',
        kind: 'x',
        credentialId: 'credential',
        externalAccountId: '123',
        destination: { type: 'account', id: '123', name: 'Editor' },
        providerId: 'x',
        credentialState: 'active',
        credentialExpiresAt: null,
        endpointUrl: null,
        authentication: null,
        attempt: 1,
        media: [],
    }
    const input: BuiltInProviderExecutionInput = {
        target,
        now,
        threadStore: store,
        credentials: {} as never,
        providerMediaDeliveryStore: {} as never,
    }
    return {
        database,
        manual,
        project,
        publication,
        workflow,
        job,
        store,
        input,
        close: () => closeTestDatabase(database),
    }
}

function adapter(execute: BuiltInProviderAdapter['execute']) {
    return withThreadExecution(
        { providerId: 'x', contractId: 'x', revision: 'post-v1', execute },
        'post-v2',
        isXPostTextValid
    )
}

it('resumes the immutable chain from receipts after rate limiting without resending the root', async () => {
    const f = await fixture()
    try {
        const calls: BuiltInProviderExecutionInput[] = []
        let rejected = false
        const publisher = adapter(async input => {
            calls.push(input)
            if (input.target.content.text === 'Second' && !rejected) {
                rejected = true
                return {
                    type: 'retryable_failure',
                    effectOccurred: false,
                    errorMessage: 'Rate limited',
                }
            }
            return {
                type: 'published',
                externalId:
                    input.target.content.text === 'Root'
                        ? '100'
                        : input.target.content.text === 'Second'
                          ? '200'
                          : '300',
            }
        })
        const partial = await publisher.execute(f.input)
        expect(partial).toMatchObject({
            type: 'checkpointed_failure',
            effectOccurred: true,
            retryable: true,
            confirmedMessageCount: 1,
        })
        expect(
            await f.workflow.completeExternalEffect({
                jobId: f.job.id,
                claimToken: 'claim',
                completedAt: now,
                outcome: partial,
                retryAt: now + 1,
            })
        ).toBe('retry_scheduled')
        expect(
            await publisher.execute({
                ...f.input,
                threadStore: createPublicationThreadStore(f.database),
            })
        ).toEqual({ type: 'published', externalId: '100' })
        expect(calls.map(call => call.target.content.text)).toEqual([
            'Root',
            'Second',
            'Second',
            'Third',
        ])
        expect(calls[2]!.threadMessage).toEqual({
            position: 1,
            root: { externalId: '100' },
            parent: { externalId: '100' },
        })
        expect(calls[3]!.threadMessage?.parent.externalId).toBe('200')
        expect(
            (await f.store.listPublication(f.project.id, f.publication.id)).map(row => row.state)
        ).toEqual(['confirmed', 'confirmed', 'confirmed'])
        const fact = await f.database.sql
            .statement<{ metadata: string }>(
                "select metadata_json as metadata from audit_events where action = 'publication.execution.retry_scheduled'"
            )
            .get()
        expect(JSON.parse(fact!.metadata)).toMatchObject({
            effectOccurred: true,
            confirmedMessageCount: 1,
        })
    } finally {
        await f.close()
    }
})

for (const resolution of ['published', 'failed'] as const)
    it(`reviews only the uncertain message as ${resolution} before safely continuing`, async () => {
        const f = await fixture()
        try {
            const calls: string[] = []
            let interrupted = true
            const publisher = adapter(async input => {
                const text = String(input.target.content.text)
                calls.push(text)
                if (text === 'Second' && interrupted)
                    return { type: 'ambiguous', errorMessage: 'Connection lost after dispatch' }
                return {
                    type: 'published',
                    externalId: text === 'Root' ? '100' : text === 'Second' ? '200' : '300',
                }
            })
            const unknown = await publisher.execute(f.input)
            expect(unknown.type).toBe('ambiguous')
            await f.workflow.completeExternalEffect({
                jobId: f.job.id,
                claimToken: 'claim',
                completedAt: now,
                outcome: unknown,
            })
            expect((await publisher.execute(f.input)).type).toBe('ambiguous')
            expect(calls).toEqual(['Root', 'Second'])
            await expect(
                f.manual.reconcileAmbiguousPublication({
                    projectId: f.project.id,
                    publicationId: f.publication.id,
                    subjectId: 'editor',
                    resolution: 'published',
                    externalId: '200',
                })
            ).rejects.toThrow('Review the uncertain thread message')
            const reviewed = await f.manual.reconcileAmbiguousPublication({
                projectId: f.project.id,
                publicationId: f.publication.id,
                subjectId: 'editor',
                resolution,
                threadMessagePosition: 1,
                externalId: resolution === 'published' ? '200' : undefined,
                errorMessage: 'Not sent',
            })
            expect(reviewed).toMatchObject({ kind: 'reconciled', publication: { state: 'failed' } })
            expect(
                (await f.manual.getPublicationEditorState(
                    f.project.id,
                    f.publication.id,
                    'editor'
                ))!.threadMessages![1]!.state
            ).toBe(resolution === 'published' ? 'confirmed' : 'failed')
            const current = (await f.manual.getPublicationEditorState(
                f.project.id,
                f.publication.id,
                'editor'
            ))!
            await expect(
                f.manual.promotePublicationDraft({
                    projectId: f.project.id,
                    publicationId: f.publication.id,
                    subjectId: 'editor',
                    expectedRevision: current.draft.revision,
                })
            ).rejects.toThrow('A started thread keeps its original version')
            expect(
                await f.manual.retryFailedPublication({
                    projectId: f.project.id,
                    publicationId: f.publication.id,
                    subjectId: 'editor',
                })
            ).toMatchObject({ kind: 'retried' })
            const retried = await f.workflow.claimNextDueJob({
                actorId: (await f.workflow.ensureSystemActor(f.project.id, now))!,
                claimToken: 'retry',
                now,
                leaseExpiresAt: now + 60_000,
            })
            expect(retried!.id).toBe(f.job.id)
            interrupted = false
            expect(await publisher.execute(f.input)).toEqual({
                type: 'published',
                externalId: '100',
            })
            expect(calls).toEqual(
                resolution === 'published'
                    ? ['Root', 'Second', 'Third']
                    : ['Root', 'Second', 'Second', 'Third']
            )
        } finally {
            await f.close()
        }
    })

it('blocks an interrupted sending checkpoint and any replacement execution after partial public effects', async () => {
    const f = await fixture()
    try {
        const identity = {
            projectId: f.project.id,
            executionRevisionId: f.input.target.executionRevisionId,
            position: 0,
        }
        await f.store.reserve(identity)
        await f.store.start(identity)
        let calls = 0
        const publisher = adapter(async () => {
            calls++
            return { type: 'published', externalId: '100' }
        })
        expect((await publisher.execute(f.input)).type).toBe('ambiguous')
        expect(await f.store.hasPriorEffects(f.project.id, f.publication.id, 'replacement')).toBe(
            true
        )
        expect(
            (
                await publisher.execute({
                    ...f.input,
                    target: { ...f.input.target, executionRevisionId: 'replacement' },
                })
            ).type
        ).toBe('ambiguous')
        expect(calls).toBe(0)
        expect(await f.store.listPublication('foreign-project', f.publication.id)).toEqual([])
        await expect(
            f.store.reserve({ ...identity, projectId: 'foreign-project' })
        ).rejects.toThrow()
    } finally {
        await f.close()
    }
})

it('validates every continuation before any message becomes public', async () => {
    const f = await fixture()
    try {
        let calls = 0
        const publisher = adapter(async () => {
            calls++
            return { type: 'published', externalId: '100' }
        })
        for (const thread of [
            [{ text: 'Second' }, { text: '日'.repeat(200) }],
            [{ text: ' ' }],
            Array.from({ length: 25 }, () => ({ text: 'Reply' })),
        ]) {
            expect(
                (
                    await publisher.execute({
                        ...f.input,
                        target: {
                            ...f.input.target,
                            content: { ...f.input.target.content, thread },
                        },
                    })
                ).type
            ).toBe('permanent_failure')
        }
        expect(calls).toBe(0)
        expect(await f.store.listPublication(f.project.id, f.publication.id)).toEqual([])
    } finally {
        await f.close()
    }
})
