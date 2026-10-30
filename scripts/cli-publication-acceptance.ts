import assert from 'node:assert/strict'
import { join } from 'node:path'

import type { PostdotClient } from '@postdot/client'

import { result } from '../packages/cli/src/context'

type Invoke = (
    args: string[],
    options?: { input?: string; expectedStatus?: number }
) => Promise<string>

export async function qualifyPublications({
    invoke,
    client,
    projectId,
    assetId,
    directory,
    label,
    now,
}: {
    invoke: Invoke
    client: PostdotClient
    projectId: string
    assetId: string
    directory: string
    label: string
    now: () => number
}) {
    const scope = client.api.projects({ projectId })
    const { channel } = await result(scope.channels.post({ name: `CLI workflow ${label}` }))
    const { channel: replacement } = await result(
        scope.channels.post({ name: `CLI replacement ${label}` })
    )
    const channels = JSON.parse(await invoke(['channels', 'list']))
    assert.ok(channels.channels.some((item: { id: string }) => item.id === channel.id))
    const contract = JSON.parse(await invoke(['channels', 'profile', '--channel', channel.id]))
    assert.ok(contract.active.profile.capabilities)
    const makePost = (scheduledAt?: number) => ({
        sourceContent: {
            body: { format: 'plain_text', text: 'Source copy' },
            media: [{ assetId }],
        },
        publications: [
            {
                channelId: channel.id,
                deliveryMode: 'manual',
                targetContent: { body: '2026-10-30', media: [{ assetId }] },
                ...(scheduledAt === undefined ? {} : { scheduledAt }),
            },
        ],
    })
    const create = async (input: unknown) =>
        JSON.parse(
            await invoke(['posts', 'create', '--input', '-'], { input: JSON.stringify(input) })
        )
    const created = await create(makePost())
    const publicationId = created.publications[0].id
    const show = async (id: string) =>
        JSON.parse(await invoke(['publications', 'show', '--publication', id])).editor
    const original = await show(publicationId)
    assert.equal(original.draft.content.body, '2026-10-30')
    assert.equal(
        JSON.parse(await invoke(['publications', 'cadence', '--publication', publicationId])),
        null
    )
    const draftFile = join(directory, `draft-${label}.json`)
    await Bun.write(
        draftFile,
        JSON.stringify({
            expectedRevision: original.draft.revision,
            targetContent: { body: 'Revised destination copy', media: [] },
        })
    )
    const saved = JSON.parse(
        await invoke(['publications', 'save', '--publication', publicationId, '--input', draftFile])
    )
    const stale = JSON.parse(
        await invoke(
            ['publications', 'save', '--publication', publicationId, '--input', draftFile],
            { expectedStatus: 1 }
        )
    )
    assert.equal(stale.error.details.status, 409)
    assert.notEqual(stale.error.code, 'http_error')
    assert.equal((await show(publicationId)).draft.revision, saved.editor.draft.revision)
    const at = now() + 3_600_000
    await invoke([
        'publications',
        'promote',
        '--publication',
        publicationId,
        '--expected-revision',
        String(saved.editor.draft.revision),
        '--at',
        String(at),
    ])
    await invoke([
        'publications',
        'schedule',
        '--publications',
        publicationId,
        '--at',
        String(at + 60_000),
    ])
    assert.equal((await show(publicationId)).publication.scheduledAt, at + 60_000)
    const listed = JSON.parse(await invoke(['publications', 'list']))
    assert.ok(listed.publications.some((item: { id: string }) => item.id === publicationId))
    assert.ok('nextCursor' in listed)
    await invoke(['publications', 'cancel', '--publications', publicationId])
    assert.equal((await show(publicationId)).publication.state, 'cancelled')
    const retry = JSON.parse(
        await invoke(['publications', 'retry', '--publication', publicationId], {
            expectedStatus: 1,
        })
    )
    assert.equal(retry.error.code, 'invalid_transition')
    const reconcile = JSON.parse(
        await invoke(
            [
                'publications',
                'reconcile',
                '--publication',
                publicationId,
                '--resolution',
                'failed',
                '--error-message',
                'Verified absent',
            ],
            { expectedStatus: 1 }
        )
    )
    assert.equal(reconcile.error.details.status, 409)
    assert.equal((await show(publicationId)).publication.state, 'cancelled')
    const before = JSON.parse(await invoke(['publications', 'list'])).summary.total
    await invoke(['posts', 'create', '--input', '-'], { input: '[]', expectedStatus: 2 })
    await invoke(['posts', 'create', '--input', '-'], {
        input: ' '.repeat(1_048_577),
        expectedStatus: 2,
    })
    await invoke(['posts', 'create', '--input', '-'], { input: '{broken', expectedStatus: 2 })
    assert.equal(JSON.parse(await invoke(['publications', 'list'])).summary.total, before)

    const moving = await create(makePost())
    const editor = await show(moving.publications[0].id)
    const moved = JSON.parse(
        await invoke(
            ['publications', 'move', '--publication', editor.publication.id, '--input', '-'],
            {
                input: JSON.stringify({
                    targetChannelId: replacement.id,
                    deliveryMode: 'manual',
                    expectedPublicationUpdatedAt: editor.publication.updatedAt,
                    expectedDraftRevision: editor.draft.revision,
                    expectedSourceRevision: editor.post.sourceRevision,
                    expectedTargetRevisionId: editor.publication.targetRevisionId,
                    expectedScheduledAt: editor.publication.scheduledAt,
                    expectedTargetProfileVersionId: replacement.profileVersionId,
                }),
            }
        )
    )
    assert.equal(moved.editor.publication.channelId, replacement.id)
    assert.equal(moved.editor.movement.fromPublicationId, editor.publication.id)

    // Manual completion records an action done by an operator, without a provider call.
    const due = await create(makePost(now()))
    const dueId = due.publications[0].id
    const awaiting = JSON.parse(await invoke(['publications', 'due']))
    assert.ok(JSON.stringify(awaiting).includes(dueId))
    await invoke([
        'publications',
        'publish',
        '--publication',
        dueId,
        '--external-url',
        'https://example.com/published',
    ])
    assert.equal((await show(dueId)).publication.state, 'published')

    // A quota conflict must retain the civil date and explicit confirmation token.
    await result(
        scope.channels({ channelId: channel.id }).cadence.put({
            expectedRevision: 0,
            dailyMax: 1,
            weeklyMax: null,
            minimumIntervalMs: null,
            timeZone: 'UTC',
        })
    )
    const future = now() + 86_400_000
    await create(makePost(future))
    const conflict = JSON.parse(
        await invoke(['posts', 'create', '--input', '-'], {
            input: JSON.stringify(makePost(future)),
            expectedStatus: 1,
        })
    )
    assert.equal(conflict.error.code, 'cadence_conflict')
    const details = conflict.error.details.server
    assert.match(details.confirmation, /^[a-f0-9]{64}$/)
    assert.match(details.warnings[0].period, /^\d{4}-\d{2}-\d{2}$/)
    const confirmed = await create({
        ...makePost(future),
        cadenceConfirmation: details.confirmation,
    })
    assert.equal(confirmed.publications.length, 1)
    const readOnly = await result(
        client.api['api-keys'].post({
            name: `Read-only ${label}`,
            projectIds: [projectId],
            actionAccess: ['project:read'],
        })
    )
    const publishers = JSON.parse(await invoke(['publishers', 'list']))
    assert.ok(Array.isArray(publishers.connections))
    const assets = JSON.parse(await invoke(['media', 'list']))
    assert.ok(assets.total > 0)
    const asset = JSON.parse(await invoke(['media', 'show', '--asset', assetId]))
    assert.equal(asset.asset.id, assetId)
    return { readOnlyToken: readOnly.token, postInput: makePost() }
}

export async function qualifyUncertainWrite(machine: Invoke, projectId: string) {
    let writes = 0
    const dropping = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request, server) {
            await request.text()
            writes++
            void server.stop(true)
            return new Response(null)
        },
    })
    try {
        const failure = JSON.parse(
            await machine(
                [
                    'posts',
                    'create',
                    '--base-url',
                    dropping.url.origin,
                    '--project',
                    projectId,
                    '--input',
                    '-',
                ],
                {
                    input: JSON.stringify({
                        sourceContent: {
                            body: { text: 'Uncertain write', format: 'plain_text' },
                            media: [],
                        },
                        publications: [],
                    }),
                    expectedStatus: 1,
                }
            )
        )
        assert.equal(failure.error.code, 'transport_error')
        assert.equal(writes, 1, 'The CLI must not replay an uncertain write')
    } finally {
        await dropping.stop(true)
    }
}
