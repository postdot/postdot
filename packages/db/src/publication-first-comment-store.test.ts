import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChannelProfileDefinition } from '@postdot/core'

import { createMastodonCommentPolicy } from '../../../apps/api/src/providers/mastodon/comment-policy'
import { providerCommentPolicies } from '../../../apps/api/src/providers/registry'
import { type DatabaseHandle, type PostdotDatabase } from './client'
import { runMigrations } from './migrations'
import { createPublicationFirstCommentStore } from './publication-first-comment-store'
import {
    closeTestDatabase,
    foreignKeyViolations,
    insertRow,
    openHistoricalTestDatabase,
    openTestDatabase,
    testEngine,
    seedTestWorkspace,
    seedWorkspaceChannel,
    seedWorkspaceMember,
    type TestRow,
    toDbValue,
    workspaceOf,
} from './testing'

const now = 1_800_000_000_000
const accountDid = 'did:plc:bluesky-operator'
const rootUri = `at://${accountDid}/app.bsky.feed.post/comment1`
const leaseDuration = 60_000
const mastodonOrigin = 'https://social.example'
const mastodonAccountId = '10'
const mastodonStatusId = '100'
const mastodonPermalink = `${mastodonOrigin}/@owner/${mastodonStatusId}`
const mastodonRootUri = `${mastodonOrigin}/api/v1/statuses/${mastodonStatusId}`

const blueskyProfile = {
    id: 'bluesky',
    version: 2,
    profileHash: 'sha256:postdot-bluesky-post-v2',
    schemaHash: 'sha256:postdot-bluesky-post-schema-v2',
    origin: 'built_in' as const,
    contentSchema: {
        type: 'object' as const,
        properties: { text: { type: 'string' as const, minLength: 1 } },
        required: ['text'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'text', semantic: 'primary_text' as const, path: '/text' }],
    capabilities: {
        revision: 'bluesky-post-v2',
        textFields: [
            {
                bindingId: 'text',
                acceptedSourceFormats: ['plain_text' as const],
                maxLength: 3_000,
                maxGraphemes: 300,
            },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: { kind: 'built_in' as const, contractId: 'bluesky', revision: 'post-v2' },
}

const mastodonProfile = {
    id: 'mastodon',
    version: 1,
    profileHash: 'sha256:postdot-mastodon-status-v1',
    schemaHash: 'sha256:postdot-mastodon-status-schema-v1',
    origin: 'built_in' as const,
    contentSchema: {
        type: 'object' as const,
        properties: { text: { type: 'string' as const, minLength: 1, maxLength: 500 } },
        required: ['text'],
        additionalProperties: false,
    },
    fieldBindings: [{ id: 'text', semantic: 'primary_text' as const, path: '/text' }],
    capabilities: {
        revision: 'mastodon-status-v1',
        textFields: [
            {
                bindingId: 'text',
                acceptedSourceFormats: ['plain_text' as const],
                maxLength: 500,
            },
        ],
        mediaFields: [],
        relations: [],
    },
    execution: { kind: 'built_in' as const, contractId: 'mastodon', revision: 'status-v1' },
}

/**
 * A stand-in for the Mastodon protocol reference parser.
 *
 * The database package never depends on a provider package, so the protocol
 * parser is injected by the application. The double mirrors the contract the
 * store relies on: a numeric local status identifier and a retained permalink
 * identify one status of one instance.
 */
function resolveMastodonStatusReference(
    externalId: string | null,
    externalUrl: string | null
): { readonly origin: string; readonly statusId: string; readonly rootUri: string } | null {
    if (externalId === null || !/^\d+$/.test(externalId) || externalUrl === null) return null
    try {
        const url = new URL(externalUrl)
        if (url.username || url.password || url.search || url.hash) return null
        if (
            !new RegExp(`^/(?:@[^/]+/${externalId}|users/[^/]+/statuses/${externalId})$`).test(
                url.pathname
            )
        )
            return null
        return {
            origin: url.origin,
            statusId: externalId,
            rootUri: `${url.origin}/api/v1/statuses/${externalId}`,
        }
    } catch {
        return null
    }
}

interface Fixture {
    readonly database: DatabaseHandle
    readonly provider: 'bluesky' | 'mastodon'
    readonly projectId: string
    readonly editorSubjectId: string
    readonly editorActorId: string
    readonly workspaceActorId: string
    readonly otherEditorSubjectId: string
    readonly otherEditorActorId: string
    readonly viewerSubjectId: string
    readonly outsiderSubjectId: string
    readonly publicationId: string
    readonly channelId: string
    readonly credentialId: string
    readonly connectionId: string
    readonly profileVersionId: string
    readonly targetRevisionId: string
    readonly jobId: string
    readonly executionRevisionId: string
}

async function seedAccess(
    database: Fixture['database'],
    projectId: string,
    subjectId: string,
    role: 'owner' | 'editor' | 'viewer'
): Promise<void> {
    await database.sql
        .statement(
            'insert into "project_user_grants" ("id", "project_id", "user_id", "role") values (?1, ?2, ?3, ?4)'
        )
        .run(`grant:${projectId}:${subjectId}`, projectId, subjectId, role)
}

async function seedHistoricalProjectResources(
    database: Fixture['database'],
    input: {
        readonly projectId: string
        readonly suffix: string
        readonly provider: 'bluesky' | 'mastodon'
        readonly channelId: string
        readonly profileVersionId: string
        readonly profile: ChannelProfileDefinition
        readonly editorActorId: string
        readonly credentialId: string
        readonly connectionId: string
        readonly accountId: string
        readonly endpointUrl: string | null
    }
): Promise<{ readonly workspaceId: string; readonly workspaceActorId: string }> {
    // Historical chains run on SQLite only (see the fixture's migrationsFolder).
    const client = (database as PostdotDatabase).$client
    // The upgrade refuses projects that never had a workspace, so the historical project has one.
    const workspaceId = await seedTestWorkspace(database)
    client
        .query('update projects set workspace_id = ? where id = ?')
        .run(workspaceId, input.projectId)
    client
        .query('insert into channels (id,project_id,name,profile_version_id) values (?,?,?,?)')
        .run(input.channelId, input.projectId, `${input.provider} channel`, input.profileVersionId)
    client
        .query(`insert into channel_profile_versions
            (id,project_id,channel_id,profile_id,version,origin,state,profile_json,profile_hash,schema_hash,created_by_actor_id)
            values (?,?,?,?,?,?,'active',?,?,?,?)`)
        .run(
            input.profileVersionId,
            input.projectId,
            input.channelId,
            input.profile.id,
            input.profile.version,
            input.profile.origin,
            JSON.stringify(input.profile),
            input.profile.profileHash,
            input.profile.schemaHash,
            input.editorActorId
        )
    client
        .query('insert into publishers (id,project_id,channel_id,kind) values (?,?,?,?)')
        .run(`publisher-${input.suffix}`, input.projectId, input.channelId, input.provider)
    client
        .query(`insert into publisher_credentials
            (id,project_id,provider_id,external_account_id,external_account_name,scopes,state,connected_by_actor_id,encryption_version,encryption_key_id,access_token_ciphertext,access_token_nonce)
            values (?,?,?,?,?,?,'active',?,1,'first-comment-test-key',?,?)`)
        .run(
            input.credentialId,
            input.projectId,
            input.provider,
            input.accountId,
            `${input.provider} operator`,
            input.provider === 'bluesky' ? '["atproto"]' : '["read:accounts","write:statuses"]',
            input.editorActorId,
            Buffer.alloc(24, 3),
            Buffer.alloc(12, 4)
        )
    client
        .query(`insert into publisher_connections
            (id,project_id,publisher_id,credential_id,endpoint_url,connected_by_actor_id)
            values (?,?,?,?,?,?)`)
        .run(
            input.connectionId,
            input.projectId,
            `publisher-${input.suffix}`,
            input.credentialId,
            input.endpointUrl,
            input.editorActorId
        )
    return { workspaceId, workspaceActorId: input.editorActorId }
}

async function createFixture(
    suffix = 'one',
    provider: 'bluesky' | 'mastodon' = 'bluesky',
    options: { readonly migrationsFolder?: string } = {}
): Promise<Fixture> {
    const database =
        options.migrationsFolder === undefined
            ? (await openTestDatabase()).database
            : openHistoricalTestDatabase(options.migrationsFolder)

    const projectId = `project-${suffix}`
    const editorSubjectId = 'editor-user'
    const otherEditorSubjectId = 'other-editor-user'
    const viewerSubjectId = 'viewer-user'
    const outsiderSubjectId = 'outsider-user'
    const editorActorId = `actor-${suffix}-editor`
    const otherEditorActorId = `actor-${suffix}-other-editor`
    const channelId = `channel-${suffix}`
    const credentialId = `credential-${suffix}`
    const connectionId = `connection-${suffix}`
    const profileVersionId = `profile-${suffix}`
    const targetRevisionId = `target-${suffix}`
    const publicationId = `publication-${suffix}`
    const jobId = `job-${suffix}`
    const executionRevisionId = `execution-${suffix}`

    await database.sql
        .statement('insert into "projects" ("id", "name") values (?1, ?2)')
        .run(projectId, `First comment project ${suffix}`)
    await insertRow(
        database,
        'user',
        [editorSubjectId, otherEditorSubjectId, viewerSubjectId, outsiderSubjectId].map(
            subjectId => ({
                id: subjectId,
                name: subjectId,
                email: `${subjectId}@first-comment.local`,
            })
        )
    )
    await insertRow(
        database,
        'instance_memberships',
        [editorSubjectId, otherEditorSubjectId, viewerSubjectId, outsiderSubjectId].map(
            subjectId => ({
                id: `instance-membership:${subjectId}`,
                userId: subjectId,
                role: 'member' as const,
                state: 'enabled' as const,
            })
        )
    )
    for (const [subjectId, role] of [
        [editorSubjectId, 'editor'],
        [otherEditorSubjectId, 'editor'],
        [viewerSubjectId, 'viewer'],
    ] as const) {
        await seedAccess(database, projectId, subjectId, role)
    }
    // Historical fixtures must name historical columns rather than infer
    // today's actor scope columns from the ORM schema.
    const insertActor = database.sql.statement<
        never,
        [string, string, string, string]
    >(`insert into actors
        (id,project_id,kind,subject_id,display_name) values (?,?,'human',?,?)`)
    for (const [id, subjectId, displayName] of [
        [editorActorId, editorSubjectId, 'Enabling Editor'],
        [otherEditorActorId, otherEditorSubjectId, 'Second Editor'],
        [`actor-${suffix}-viewer`, viewerSubjectId, 'Project Viewer'],
    ])
        await insertActor.run(id!, projectId, subjectId!, displayName!)
    const profile = provider === 'bluesky' ? blueskyProfile : mastodonProfile
    // A historical chain (project-owned columns) cannot use today's workspace-owned seeding.
    const historical = options.migrationsFolder !== undefined
    const owned = historical
        ? await seedHistoricalProjectResources(database, {
              projectId,
              suffix,
              provider,
              channelId,
              profileVersionId,
              profile,
              editorActorId,
              credentialId,
              connectionId,
              accountId: provider === 'bluesky' ? accountDid : mastodonAccountId,
              endpointUrl: provider === 'bluesky' ? null : mastodonOrigin,
          })
        : await (async () => {
              const seeded = await seedWorkspaceChannel(database, {
                  projectId,
                  channelId,
                  name: provider === 'bluesky' ? 'Bluesky channel' : 'Mastodon channel',
                  profileVersionId,
                  profile,
                  createdByActorId: editorActorId,
              })
              for (const subjectId of [editorSubjectId, otherEditorSubjectId, viewerSubjectId])
                  await seedWorkspaceMember(database, seeded.workspaceId, subjectId)
              await database.sql
                  .statement(
                      'insert into "publishers" ("id", "workspace_id", "channel_id", "kind") values (?1, ?2, ?3, ?4)'
                  )
                  .run(`publisher-${suffix}`, seeded.workspaceId, channelId, provider)
              await database.sql
                  .statement(
                      'insert into "publisher_credentials" ("id", "workspace_id", "provider_id", "external_account_id", "external_account_name", "scopes", "state", "connected_by_actor_id", "encryption_version", "encryption_key_id", "access_token_ciphertext", "access_token_nonce") values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)'
                  )
                  .run(
                      credentialId,
                      seeded.workspaceId,
                      provider,
                      provider === 'bluesky' ? accountDid : mastodonAccountId,
                      provider === 'bluesky' ? 'Bluesky Operator' : 'Mastodon Operator',
                      toDbValue(
                          'json',
                          provider === 'bluesky' ? ['atproto'] : ['read:accounts', 'write:statuses']
                      ),
                      'active',
                      seeded.workspaceActorId,
                      1,
                      'first-comment-test-key',
                      Buffer.alloc(24, 3),
                      Buffer.alloc(12, 4)
                  )
              await database.sql
                  .statement(
                      'insert into "publisher_connections" ("id", "workspace_id", "publisher_id", "credential_id", "endpoint_url", "connected_by_actor_id") values (?1, ?2, ?3, ?4, ?5, ?6)'
                  )
                  .run(
                      connectionId,
                      seeded.workspaceId,
                      `publisher-${suffix}`,
                      credentialId,
                      provider === 'bluesky' ? null : mastodonOrigin,
                      seeded.workspaceActorId
                  )
              return seeded
          })()
    await database.sql
        .statement(
            'insert into "posts" ("id", "project_id", "source_content", "source_revision", "created_by_actor_id") values (?1, ?2, ?3, ?4, ?5)'
        )
        .run(
            `post-${suffix}`,
            projectId,
            toDbValue('json', { body: { text: 'Parent post', format: 'plain_text' }, media: [] }),
            1,
            editorActorId
        )
    await database.sql
        .statement(`insert into publications (id,project_id,post_id,channel_id,target_revision_id,delivery_mode,review_state,state,scheduled_at,created_by_actor_id,scheduled_by_actor_id,state_changed_by_actor_id)
        values (?,?,?,?,?,'automatic','compatible','scheduled',?,?,?,?)`)
        .run(
            publicationId,
            projectId,
            `post-${suffix}`,
            channelId,
            targetRevisionId,
            now,
            editorActorId,
            editorActorId,
            editorActorId
        )
    await database.sql
        .statement(
            'insert into "publication_target_revisions" ("id", "project_id", "publication_id", "sequence", "profile_version_id", "source_revision", "delivery_mode", "content_json", "content_hash", "profile_hash", "schema_hash", "validation_issues_json", "created_by_actor_id") values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)'
        )
        .run(
            targetRevisionId,
            projectId,
            publicationId,
            1,
            profileVersionId,
            1,
            'automatic',
            toDbValue('json', { text: 'Parent post' }),
            `sha256:target-${suffix}`,
            profile.profileHash,
            profile.schemaHash,
            toDbValue('json', []),
            editorActorId
        )

    return {
        database,
        provider,
        projectId,
        editorSubjectId,
        editorActorId,
        workspaceActorId: owned.workspaceActorId,
        otherEditorSubjectId,
        otherEditorActorId,
        viewerSubjectId,
        outsiderSubjectId,
        publicationId,
        channelId,
        credentialId,
        connectionId,
        profileVersionId,
        targetRevisionId,
        jobId,
        executionRevisionId,
    }
}

/** Records a native, automatically delivered parent receipt. */
async function publishNatively(
    fixture: Fixture,
    options: {
        readonly publishedAt: number
        readonly jobState?: 'succeeded' | 'failed'
        readonly deliveryMode?: 'automatic' | 'manual'
        readonly statusId?: string
        readonly permalink?: string
    }
): Promise<void> {
    const profile = fixture.provider === 'bluesky' ? blueskyProfile : mastodonProfile
    await fixture.database.sql
        .statement(
            'update "publications" set "state" = ?1, "published_at" = ?2, "published_by_actor_id" = ?3, "state_changed_by_actor_id" = ?4, "external_id" = ?5, "external_url" = ?6, "delivery_mode" = ?7, "scheduled_at" = ?8, "scheduled_by_actor_id" = ?9 where "publications"."id" = ?10'
        )
        .run(
            'published',
            options.publishedAt,
            fixture.editorActorId,
            fixture.editorActorId,
            fixture.provider === 'bluesky' ? rootUri : (options.statusId ?? mastodonStatusId),
            fixture.provider === 'bluesky'
                ? `https://bsky.app/profile/${accountDid}/app.bsky.feed.post/comment1`
                : (options.permalink ?? mastodonPermalink),
            options.deliveryMode ?? 'automatic',
            null,
            null,
            fixture.publicationId
        )
    if (options.deliveryMode === 'manual') return
    await fixture.database.sql
        .statement(
            'insert into "jobs" ("id", "project_id", "publication_id", "state", "run_at", "started_at", "completed_at", "error_message") values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)'
        )
        .run(
            fixture.jobId,
            fixture.projectId,
            fixture.publicationId,
            options.jobState ?? 'succeeded',
            options.publishedAt,
            options.publishedAt,
            options.publishedAt,
            options.jobState === 'failed' ? 'Provider rejected the parent post' : null
        )
    if (options.jobState === 'failed') return
    await fixture.database.sql
        .statement(
            'insert into "publication_execution_revisions" ("id", "project_id", "job_id", "publication_id", "target_revision_id", "profile_version_id", "delivery_mode", "media_reference_count", "content_json", "content_hash", "profile_hash", "schema_hash") values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)'
        )
        .run(
            fixture.executionRevisionId,
            fixture.projectId,
            fixture.jobId,
            fixture.publicationId,
            fixture.targetRevisionId,
            fixture.profileVersionId,
            'automatic',
            0,
            toDbValue('json', { text: 'Parent post' }),
            `sha256:target-${fixture.targetRevisionId}`,
            profile.profileHash,
            profile.schemaHash
        )
}

/**
 * Creates the store of a fixture.
 *
 * A Mastodon fixture always receives the protocol reference parser, unless the
 * test asks for a store without it.
 */
function createStore(fixture: Fixture, options: { readonly withParser?: boolean } = {}) {
    const withParser = options.withParser ?? true
    return createPublicationFirstCommentStore(fixture.database, {
        policies: providerCommentPolicies.map(policy =>
            policy.id === 'mastodon'
                ? createMastodonCommentPolicy(withParser ? resolveMastodonStatusReference : null)
                : policy
        ),
    })
}

function saveComment(
    fixture: Fixture,
    options: {
        readonly text?: string
        readonly delaySeconds?: number
        readonly expectedRevision?: number
        readonly recordKey?: string
        readonly subjectId?: string
        readonly at?: number
    } = {}
) {
    return createStore(fixture).save({
        projectId: fixture.projectId,
        publicationId: fixture.publicationId,
        subjectId: options.subjectId ?? fixture.editorSubjectId,
        text: options.text ?? 'Thanks for the update',
        delaySeconds: options.delaySeconds ?? 300,
        expectedRevision: options.expectedRevision ?? 0,
        recordKey: options.recordKey ?? 'comment1',
        now: options.at ?? now,
    })
}

async function readRow(fixture: Fixture) {
    return (
        (await fixture.database.sql
            .statement<TestRow>(
                'select "publication_first_comments"."id" as "id", "publication_first_comments"."project_id" as "projectId", "publication_first_comments"."publication_id" as "publicationId", "publication_first_comments"."actor_id" as "actorId", "publication_first_comments"."text" as "text", "publication_first_comments"."delay_seconds" as "delaySeconds", "publication_first_comments"."state" as "state", "publication_first_comments"."provider_id" as "providerId", "publication_first_comments"."instance_origin" as "instanceOrigin", "publication_first_comments"."revision" as "revision", "publication_first_comments"."due_at" as "dueAt", "publication_first_comments"."root_uri" as "rootUri", "publication_first_comments"."execution_revision_id" as "executionRevisionId", "publication_first_comments"."connection_id" as "connectionId", "publication_first_comments"."credential_id" as "credentialId", "publication_first_comments"."account_id" as "accountId", "publication_first_comments"."record_key" as "recordKey", "publication_first_comments"."attempts" as "attempts", "publication_first_comments"."claim_token" as "claimToken", "publication_first_comments"."lease_expires_at" as "leaseExpiresAt", "publication_first_comments"."effect_started_at" as "effectStartedAt", "publication_first_comments"."external_id" as "externalId", "publication_first_comments"."external_url" as "externalUrl", "publication_first_comments"."last_error" as "lastError", "publication_first_comments"."created_at" as "createdAt", "publication_first_comments"."updated_at" as "updatedAt" from "publication_first_comments" where "publication_first_comments"."publication_id" = ?1'
            )
            .get(fixture.publicationId)) ?? undefined
    )
}

async function journalActions(fixture: Fixture): Promise<string[]> {
    return (
        await fixture.database.sql
            .statement<TestRow>(
                'select "audit_events"."sequence" as "sequence", "audit_events"."id" as "id", "audit_events"."project_id" as "projectId", "audit_events"."workspace_id" as "workspaceId", "audit_events"."actor_id" as "actorId", "audit_events"."action" as "action", "audit_events"."entity_type" as "entityType", "audit_events"."entity_id" as "entityId", "audit_events"."metadata_json" as "metadataJson", "audit_events"."event_version" as "eventVersion", "audit_events"."correlation_id" as "correlationId", "audit_events"."causation_id" as "causationId", "audit_events"."created_at" as "createdAt" from "audit_events"'
            )
            .all()
    )
        .map(event => event.action)
        .filter(action => action.startsWith('publication_first_comment.'))
}

describe('publication first comment store', () => {
    it('keeps mutations project-scoped and editor-gated', async () => {
        const fixture = await createFixture('permissions')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })

            expect(await saveComment(fixture, { subjectId: fixture.viewerSubjectId })).toEqual({
                kind: 'not_found',
            })
            expect(await saveComment(fixture, { subjectId: fixture.outsiderSubjectId })).toEqual({
                kind: 'not_found',
            })
            expect(
                await store.cancel({
                    projectId: fixture.projectId,
                    publicationId: fixture.publicationId,
                    subjectId: fixture.viewerSubjectId,
                    expectedRevision: 0,
                    now,
                })
            ).toEqual({ kind: 'not_found' })
            expect(
                await store.get(fixture.projectId, fixture.publicationId, fixture.outsiderSubjectId)
            ).toBeNull()

            const created = await saveComment(fixture)
            expect(created.kind).toBe('saved')
            if (created.kind !== 'saved') return

            expect(
                await store.get(fixture.projectId, fixture.publicationId, fixture.viewerSubjectId)
            ).toMatchObject({ id: created.firstComment.id, state: 'waiting' })
            expect(
                await store.get(fixture.projectId, fixture.publicationId, fixture.outsiderSubjectId)
            ).toBeNull()
            expect(
                await store.view(fixture.projectId, fixture.publicationId, fixture.viewerSubjectId)
            ).toEqual({
                id: created.firstComment.id,
                text: 'Thanks for the update',
                delaySeconds: 300,
                state: 'waiting',
                revision: 1,
                dueAt: null,
                createdAt: now,
                updatedAt: now,
                externalUrl: null,
                lastError: null,
                authorName: 'Enabling Editor',
            })
            expect(await store.canManage(fixture.projectId, fixture.editorSubjectId)).toBe(true)
            expect(await store.canManage(fixture.projectId, fixture.viewerSubjectId)).toBe(false)
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('rejects ineligible publications and invalid content', async () => {
        const manual = await createFixture('ineligible')

        try {
            await manual.database.sql
                .statement(
                    'update "publications" set "delivery_mode" = ?1 where "publications"."id" = ?2'
                )
                .run('manual', manual.publicationId)

            expect(await saveComment(manual)).toEqual({ kind: 'conflict' })
            expect(
                await createPublicationFirstCommentStore(manual.database, {
                    policies: providerCommentPolicies,
                }).canConfigure(manual.projectId, manual.publicationId)
            ).toBe(false)
        } finally {
            await closeTestDatabase(manual.database)
        }

        const fixture = await createFixture('content')

        try {
            await expect(saveComment(fixture, { text: '   ' })).rejects.toThrow('must not be blank')
            await expect(saveComment(fixture, { delaySeconds: 604_801 })).rejects.toThrow(
                'delaySeconds must be an integer between 0 and 604800'
            )
            await expect(saveComment(fixture, { delaySeconds: -1 })).rejects.toThrow(
                'delaySeconds must be an integer between 0 and 604800'
            )
            await expect(saveComment(fixture, { text: 'a'.repeat(3_001) })).rejects.toThrow(
                'must not exceed 3000 UTF-16 code units'
            )
            await expect(saveComment(fixture, { text: 'e\u0301'.repeat(301) })).rejects.toThrow(
                'must not exceed 300 graphemes'
            )
            expect((await saveComment(fixture, { text: 'e\u0301'.repeat(300) })).kind).toBe('saved')
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('arms only a natively confirmed parent and keeps the chosen due time', async () => {
        const fixture = await createFixture('native')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            const created = await saveComment(fixture, { delaySeconds: 300 })
            expect(created.kind).toBe('saved')
            if (created.kind !== 'saved') return

            await store.reconcile(now)
            expect(await readRow(fixture)).toMatchObject({ state: 'waiting', dueAt: null })
            expect(await store.getNextEventAt()).toBeNull()

            const publishedAt = now + 1_000
            await publishNatively(fixture, { publishedAt })

            // A confirmed parent must wake the worker so the comment is armed
            // on the next tick instead of waiting for a timer that never fires.
            expect(await store.getNextEventAt()).not.toBeNull()

            await store.reconcile(publishedAt)

            expect(await readRow(fixture)).toMatchObject({
                state: 'pending',
                dueAt: publishedAt + 300_000,
                rootUri,
                accountId: accountDid,
                connectionId: fixture.connectionId,
                credentialId: fixture.credentialId,
                executionRevisionId: fixture.executionRevisionId,
                revision: 1,
            })
            expect(await store.getNextEventAt()).toBe(publishedAt + 300_000)

            expect(
                await store.deliveries.claimNextDueJob({
                    actorId: fixture.editorActorId,
                    claimToken: 'claim-too-early',
                    now: publishedAt + 299_999,
                    leaseExpiresAt: publishedAt + 300_000 + leaseDuration,
                })
            ).toBeNull()

            const claimed = await store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-due',
                now: publishedAt + 300_000,
                leaseExpiresAt: publishedAt + 300_000 + leaseDuration,
            })
            expect(claimed).toMatchObject({ state: 'running', attempts: 1 })
            expect(await journalActions(fixture)).toEqual([
                'publication_first_comment.requested',
                'publication_first_comment.armed',
            ])
            expect(await foreignKeyViolations(fixture.database)).toEqual([])
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('keeps an overdue comment due after downtime without resetting its delay', async () => {
        const fixture = await createFixture('overdue')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture, { delaySeconds: 3_600 })
            const publishedAt = now + 1_000
            await publishNatively(fixture, { publishedAt })
            await store.reconcile(publishedAt)

            const restartedAt = publishedAt + 10 * 3_600_000
            await store.reconcile(restartedAt)

            expect(await readRow(fixture)).toMatchObject({
                state: 'pending',
                dueAt: publishedAt + 3_600_000,
            })
            expect(await store.getNextEventAt()).toBe(publishedAt + 3_600_000)

            const claimed = await store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-overdue',
                now: restartedAt,
                leaseExpiresAt: restartedAt + leaseDuration,
            })
            expect(claimed).toMatchObject({ state: 'running', dueAt: publishedAt + 3_600_000 })
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('never arms a manual, failed or reconciled parent receipt', async () => {
        const manual = await createFixture('manual')

        try {
            const store = createPublicationFirstCommentStore(manual.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(manual)
            await publishNatively(manual, { publishedAt: now + 1, deliveryMode: 'manual' })

            await store.reconcile(now + 2)
            expect(await readRow(manual)).toMatchObject({ state: 'waiting', dueAt: null })
            expect(await store.getNextEventAt()).toBeNull()
        } finally {
            await closeTestDatabase(manual.database)
        }

        const failed = await createFixture('failed')

        try {
            const store = createPublicationFirstCommentStore(failed.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(failed)
            await publishNatively(failed, { publishedAt: now + 1, jobState: 'failed' })

            await store.reconcile(now + 2)
            expect(await readRow(failed)).toMatchObject({ state: 'waiting', dueAt: null })
            expect(await store.getNextEventAt()).toBeNull()
        } finally {
            await closeTestDatabase(failed.database)
        }
    })

    it('cancels unsent work when the parent publication is cancelled', async () => {
        const fixture = await createFixture('parent-cancelled')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture)
            await fixture.database.sql
                .statement(
                    'update "publications" set "state" = ?1, "scheduled_at" = ?2, "scheduled_by_actor_id" = ?3, "state_changed_by_actor_id" = ?4 where "publications"."id" = ?5'
                )
                .run('cancelled', null, null, fixture.editorActorId, fixture.publicationId)

            await store.reconcile(now + 1)
            expect(await readRow(fixture)).toMatchObject({ state: 'cancelled' })
            expect(await store.getNextEventAt()).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('refuses to create a comment for a revision that was never issued', async () => {
        const fixture = await createFixture('stale-create')

        try {
            expect(await saveComment(fixture, { expectedRevision: 1 })).toEqual({
                kind: 'conflict',
            })
            expect(await saveComment(fixture, { expectedRevision: 3 })).toEqual({
                kind: 'conflict',
            })
            expect(await readRow(fixture)).toBeUndefined()
            expect(
                await fixture.database.sql
                    .statement<TestRow>(
                        'select "publication_first_comments"."id" as "id", "publication_first_comments"."project_id" as "projectId", "publication_first_comments"."publication_id" as "publicationId", "publication_first_comments"."actor_id" as "actorId", "publication_first_comments"."text" as "text", "publication_first_comments"."delay_seconds" as "delaySeconds", "publication_first_comments"."state" as "state", "publication_first_comments"."provider_id" as "providerId", "publication_first_comments"."instance_origin" as "instanceOrigin", "publication_first_comments"."revision" as "revision", "publication_first_comments"."due_at" as "dueAt", "publication_first_comments"."root_uri" as "rootUri", "publication_first_comments"."execution_revision_id" as "executionRevisionId", "publication_first_comments"."connection_id" as "connectionId", "publication_first_comments"."credential_id" as "credentialId", "publication_first_comments"."account_id" as "accountId", "publication_first_comments"."record_key" as "recordKey", "publication_first_comments"."attempts" as "attempts", "publication_first_comments"."claim_token" as "claimToken", "publication_first_comments"."lease_expires_at" as "leaseExpiresAt", "publication_first_comments"."effect_started_at" as "effectStartedAt", "publication_first_comments"."external_id" as "externalId", "publication_first_comments"."external_url" as "externalUrl", "publication_first_comments"."last_error" as "lastError", "publication_first_comments"."created_at" as "createdAt", "publication_first_comments"."updated_at" as "updatedAt" from "publication_first_comments"'
                    )
                    .all()
            ).toHaveLength(0)

            const created = await saveComment(fixture, { expectedRevision: 0 })
            expect(created.kind).toBe('saved')
            if (created.kind !== 'saved') return
            expect(created.firstComment.revision).toBe(1)

            // A duplicated create is the same request and never a second row.
            const retried = await saveComment(fixture, {
                expectedRevision: 0,
                recordKey: 'other-key',
            })
            expect(retried.kind).toBe('saved')
            if (retried.kind !== 'saved') return
            expect(retried.firstComment.id).toBe(created.firstComment.id)
            expect(retried.firstComment.recordKey).toBe('comment1')
            expect(
                await fixture.database.sql
                    .statement<TestRow>(
                        'select "publication_first_comments"."id" as "id", "publication_first_comments"."project_id" as "projectId", "publication_first_comments"."publication_id" as "publicationId", "publication_first_comments"."actor_id" as "actorId", "publication_first_comments"."text" as "text", "publication_first_comments"."delay_seconds" as "delaySeconds", "publication_first_comments"."state" as "state", "publication_first_comments"."provider_id" as "providerId", "publication_first_comments"."instance_origin" as "instanceOrigin", "publication_first_comments"."revision" as "revision", "publication_first_comments"."due_at" as "dueAt", "publication_first_comments"."root_uri" as "rootUri", "publication_first_comments"."execution_revision_id" as "executionRevisionId", "publication_first_comments"."connection_id" as "connectionId", "publication_first_comments"."credential_id" as "credentialId", "publication_first_comments"."account_id" as "accountId", "publication_first_comments"."record_key" as "recordKey", "publication_first_comments"."attempts" as "attempts", "publication_first_comments"."claim_token" as "claimToken", "publication_first_comments"."lease_expires_at" as "leaseExpiresAt", "publication_first_comments"."effect_started_at" as "effectStartedAt", "publication_first_comments"."external_id" as "externalId", "publication_first_comments"."external_url" as "externalUrl", "publication_first_comments"."last_error" as "lastError", "publication_first_comments"."created_at" as "createdAt", "publication_first_comments"."updated_at" as "updatedAt" from "publication_first_comments"'
                    )
                    .all()
            ).toHaveLength(1)
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('fails a confirmed parent whose connection is gone instead of spinning', async () => {
        const fixture = await createFixture('missing-connection')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture)
            const publishedAt = now + 1_000
            await publishNatively(fixture, { publishedAt })

            // The receipt is confirmed, so the worker must wake up for it even
            // though the comment is still waiting.
            expect(await store.getNextEventAt(now)).toBe(now)

            await fixture.database.sql
                .statement(
                    'delete from "publisher_connections" where "publisher_connections"."id" = ?1'
                )
                .run(fixture.connectionId)

            await store.reconcile(publishedAt)
            expect(await readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The original connection is no longer available',
            })
            // A terminal comment leaves the schedule instead of waking the
            // worker forever.
            expect(await store.getNextEventAt(now)).toBeNull()

            await store.reconcile(publishedAt + 1)
            expect(await readRow(fixture)).toMatchObject({ state: 'failed' })
            expect(await store.getNextEventAt(now)).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('rejects a replaced account instead of arming a confirmed receipt', async () => {
        const fixture = await createFixture('replaced-account')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture)
            const publishedAt = now + 1_000
            await publishNatively(fixture, { publishedAt })

            await fixture.database.sql
                .statement(
                    'update "publisher_credentials" set "external_account_id" = ?1 where "publisher_credentials"."id" = ?2'
                )
                .run('did:plc:someone-else', fixture.credentialId)

            await store.reconcile(publishedAt)
            expect(await readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The confirmed publication does not belong to the connected account',
                rootUri: null,
                accountId: null,
                connectionId: null,
                credentialId: null,
            })
            expect(await store.getNextEventAt(now)).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('revalidates the pinned receipt and refuses a changed parent', async () => {
        const fixture = await createFixture('changed-parent')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture)
            const publishedAt = now + 1_000
            await publishNatively(fixture, { publishedAt })
            await store.reconcile(publishedAt)
            expect(await readRow(fixture)).toMatchObject({
                state: 'pending',
                rootUri,
                accountId: accountDid,
                connectionId: fixture.connectionId,
                credentialId: fixture.credentialId,
                executionRevisionId: fixture.executionRevisionId,
            })

            await fixture.database.sql
                .statement(
                    'update "publications" set "external_id" = ?1 where "publications"."id" = ?2'
                )
                .run(`at://${accountDid}/app.bsky.feed.post/other`, fixture.publicationId)

            await store.reconcile(publishedAt + 1)
            expect(await readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The confirmed parent publication changed',
                rootUri,
                accountId: accountDid,
                connectionId: fixture.connectionId,
                credentialId: fixture.credentialId,
                executionRevisionId: fixture.executionRevisionId,
            })
            expect(await store.getNextEventAt(now)).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('fails a comment whose succeeded delivery is no longer confirmed', async () => {
        const fixture = await createFixture('lost-receipt')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture)
            const publishedAt = now + 1_000
            await publishNatively(fixture, { publishedAt })
            await store.reconcile(publishedAt)
            expect(await readRow(fixture)).toMatchObject({ state: 'pending' })

            await fixture.database.sql
                .statement(
                    'update "jobs" set "state" = ?1, "error_message" = ?2 where "jobs"."id" = ?3'
                )
                .run('failed', 'The delivery was retried', fixture.jobId)

            await store.reconcile(publishedAt + 1)
            expect(await readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The confirmed publication receipt is no longer available',
                rootUri,
                accountId: accountDid,
            })
            expect(await store.getNextEventAt(now)).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('freezes the configuration capability with a terminal row', async () => {
        const fixture = await createFixture('capability')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            expect(await store.canConfigure(fixture.projectId, fixture.publicationId)).toBe(true)

            await saveComment(fixture)
            expect(await store.canConfigure(fixture.projectId, fixture.publicationId)).toBe(true)

            const cancelled = await store.cancel({
                projectId: fixture.projectId,
                publicationId: fixture.publicationId,
                subjectId: fixture.editorSubjectId,
                expectedRevision: 1,
                now: now + 1,
            })
            expect(cancelled.kind).toBe('saved')

            // The publication is still scheduled, but the terminal row can no
            // longer be configured and the store refuses to save it.
            expect(await store.canConfigure(fixture.projectId, fixture.publicationId)).toBe(false)
            expect(
                await saveComment(fixture, { expectedRevision: 2, text: 'Another attempt' })
            ).toEqual({
                kind: 'conflict',
            })
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('re-enables a suspended comment instead of swallowing the request', async () => {
        const fixture = await createFixture('suspended-enable')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture)
            const edited = await saveComment(fixture, {
                expectedRevision: 1,
                text: 'An edited comment',
            })
            expect(edited.kind).toBe('saved')

            await fixture.database.sql
                .statement(
                    'delete from "project_user_grants" where "project_user_grants"."id" = ?1'
                )
                .run(`grant:${fixture.projectId}:${fixture.editorSubjectId}`)
            await store.reconcile(now + 1)
            expect(await readRow(fixture)).toMatchObject({ state: 'suspended', revision: 2 })

            // A stale request with other content can never re-enable the work.
            const staleChange = await saveComment(fixture, {
                subjectId: fixture.otherEditorSubjectId,
                expectedRevision: 1,
                text: 'A different comment',
            })
            expect(staleChange.kind).toBe('conflict')
            expect(await readRow(fixture)).toMatchObject({ state: 'suspended', revision: 2 })

            // A delayed duplicate must not lift a later access suspension.
            expect(
                (
                    await saveComment(fixture, {
                        subjectId: fixture.otherEditorSubjectId,
                        expectedRevision: 1,
                        text: 'An edited comment',
                    })
                ).kind
            ).toBe('conflict')
            expect(await readRow(fixture)).toMatchObject({ state: 'suspended', revision: 2 })

            // The explicit enable reviews the current revision and re-attributes it.
            const reenabled = await saveComment(fixture, {
                subjectId: fixture.otherEditorSubjectId,
                expectedRevision: 2,
                text: 'An edited comment',
            })
            expect(reenabled.kind).toBe('saved')
            if (reenabled.kind !== 'saved') return
            expect(reenabled.firstComment).toMatchObject({
                state: 'waiting',
                revision: 3,
                text: 'An edited comment',
                actorId: fixture.otherEditorActorId,
                recordKey: 'comment1',
                lastError: null,
            })
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('returns the same row for a retried save and refuses a stale revision', async () => {
        const fixture = await createFixture('save')

        try {
            const created = await saveComment(fixture, { recordKey: 'first-key' })
            expect(created.kind).toBe('saved')
            if (created.kind !== 'saved') return

            const retried = await saveComment(fixture, { recordKey: 'another-key' })
            expect(retried.kind).toBe('saved')
            if (retried.kind !== 'saved') return
            expect(retried.firstComment.id).toBe(created.firstComment.id)
            expect(retried.firstComment.revision).toBe(1)
            expect(retried.firstComment.recordKey).toBe('first-key')

            expect(
                await fixture.database.sql
                    .statement<TestRow>(
                        'select "publication_first_comments"."id" as "id", "publication_first_comments"."project_id" as "projectId", "publication_first_comments"."publication_id" as "publicationId", "publication_first_comments"."actor_id" as "actorId", "publication_first_comments"."text" as "text", "publication_first_comments"."delay_seconds" as "delaySeconds", "publication_first_comments"."state" as "state", "publication_first_comments"."provider_id" as "providerId", "publication_first_comments"."instance_origin" as "instanceOrigin", "publication_first_comments"."revision" as "revision", "publication_first_comments"."due_at" as "dueAt", "publication_first_comments"."root_uri" as "rootUri", "publication_first_comments"."execution_revision_id" as "executionRevisionId", "publication_first_comments"."connection_id" as "connectionId", "publication_first_comments"."credential_id" as "credentialId", "publication_first_comments"."account_id" as "accountId", "publication_first_comments"."record_key" as "recordKey", "publication_first_comments"."attempts" as "attempts", "publication_first_comments"."claim_token" as "claimToken", "publication_first_comments"."lease_expires_at" as "leaseExpiresAt", "publication_first_comments"."effect_started_at" as "effectStartedAt", "publication_first_comments"."external_id" as "externalId", "publication_first_comments"."external_url" as "externalUrl", "publication_first_comments"."last_error" as "lastError", "publication_first_comments"."created_at" as "createdAt", "publication_first_comments"."updated_at" as "updatedAt" from "publication_first_comments" where "publication_first_comments"."publication_id" = ?1'
                    )
                    .all(fixture.publicationId)
            ).toHaveLength(1)

            expect((await saveComment(fixture, { expectedRevision: 7 })).kind).toBe('conflict')
            const edited = await saveComment(fixture, {
                expectedRevision: 1,
                text: 'An edited comment',
                delaySeconds: 1_800,
            })
            expect(edited.kind).toBe('saved')
            if (edited.kind !== 'saved') return
            expect(edited.firstComment).toMatchObject({
                revision: 2,
                text: 'An edited comment',
                delaySeconds: 1_800,
                recordKey: 'first-key',
                state: 'waiting',
            })
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('serializes cancellation against a worker claim', async () => {
        const fixture = await createFixture('cancel')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture)
            await publishNatively(fixture, { publishedAt: now + 1 })
            await store.reconcile(now + 1)
            const dueAt = now + 1 + 300_000

            const claimed = await store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-cancel-race',
                now: dueAt,
                leaseExpiresAt: dueAt + leaseDuration,
            })
            expect(claimed).not.toBeNull()

            expect(
                await store.cancel({
                    projectId: fixture.projectId,
                    publicationId: fixture.publicationId,
                    subjectId: fixture.editorSubjectId,
                    expectedRevision: 1,
                    now: dueAt + 1,
                })
            ).toEqual({ kind: 'conflict' })
            expect(await readRow(fixture)).toMatchObject({ state: 'running' })
        } finally {
            await closeTestDatabase(fixture.database)
        }

        const cancelled = await createFixture('cancel-before-claim')

        try {
            const store = createPublicationFirstCommentStore(cancelled.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(cancelled)
            await publishNatively(cancelled, { publishedAt: now + 1 })
            await store.reconcile(now + 1)

            const cancelledRow = await store.cancel({
                projectId: cancelled.projectId,
                publicationId: cancelled.publicationId,
                subjectId: cancelled.editorSubjectId,
                expectedRevision: 1,
                now: now + 2,
            })
            expect(cancelledRow.kind).toBe('saved')
            expect(
                await store.deliveries.claimNextDueJob({
                    actorId: cancelled.editorActorId,
                    claimToken: 'claim-after-cancel',
                    now: now + 1 + 300_000,
                    leaseExpiresAt: now + 1 + 300_000 + leaseDuration,
                })
            ).toBeNull()
        } finally {
            await closeTestDatabase(cancelled.database)
        }
    })

    it('suspends work when the enabling editor loses access and never resumes it alone', async () => {
        const fixture = await createFixture('suspend')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture)
            await publishNatively(fixture, { publishedAt: now + 1 })
            await store.reconcile(now + 1)

            await fixture.database.sql
                .statement(
                    'delete from "project_user_grants" where "project_user_grants"."id" = ?1'
                )
                .run(`grant:${fixture.projectId}:${fixture.editorSubjectId}`)

            await store.reconcile(now + 2)
            expect(await readRow(fixture)).toMatchObject({
                state: 'suspended',
                lastError: 'The enabling editor no longer has editor access',
            })

            await store.reconcile(now + 3)
            expect(await readRow(fixture)).toMatchObject({ state: 'suspended' })

            const reenabled = await store.save({
                projectId: fixture.projectId,
                publicationId: fixture.publicationId,
                subjectId: fixture.otherEditorSubjectId,
                text: 'Thanks for the update',
                delaySeconds: 300,
                expectedRevision: 1,
                recordKey: 'ignored-record-key',
                now: now + 4,
            })
            expect(reenabled.kind).toBe('saved')
            if (reenabled.kind !== 'saved') return
            expect(reenabled.firstComment).toMatchObject({
                state: 'pending',
                actorId: fixture.otherEditorActorId,
                recordKey: 'comment1',
                rootUri,
                accountId: accountDid,
                connectionId: fixture.connectionId,
                credentialId: fixture.credentialId,
                executionRevisionId: fixture.executionRevisionId,
                dueAt: now + 1 + 300_000,
                lastError: null,
            })
            expect(await journalActions(fixture)).toEqual([
                'publication_first_comment.requested',
                'publication_first_comment.armed',
                'publication_first_comment.suspended',
                'publication_first_comment.enabled',
            ])
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('fails closed instead of rebinding a replaced account', async () => {
        const fixture = await createFixture('rebind')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture)
            await publishNatively(fixture, { publishedAt: now + 1 })
            await store.reconcile(now + 1)

            await fixture.database.sql
                .statement(
                    'update "publisher_credentials" set "external_account_id" = ?1 where "publisher_credentials"."id" = ?2'
                )
                .run('did:plc:someone-else', fixture.credentialId)

            await store.reconcile(now + 2)
            expect(await readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The original account is no longer available',
                accountId: accountDid,
                connectionId: fixture.connectionId,
            })
            expect(await store.getNextEventAt()).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }

        const disconnected = await createFixture('disconnected')

        try {
            const store = createPublicationFirstCommentStore(disconnected.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(disconnected)
            await publishNatively(disconnected, { publishedAt: now + 1 })
            await store.reconcile(now + 1)

            await disconnected.database.sql
                .statement(
                    'delete from "publisher_connections" where "publisher_connections"."id" = ?1'
                )
                .run(disconnected.connectionId)

            await store.reconcile(now + 2)
            expect(await readRow(disconnected)).toMatchObject({
                state: 'failed',
                lastError: 'The original connection is no longer available',
                accountId: accountDid,
            })
            expect(await store.getNextEventAt()).toBeNull()
        } finally {
            await closeTestDatabase(disconnected.database)
        }
    })

    it('recovers an expired claim without an effect and keeps the send identity', async () => {
        const fixture = await createFixture('recovery')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture)
            await publishNatively(fixture, { publishedAt: now + 1 })
            await store.reconcile(now + 1)
            const dueAt = now + 1 + 300_000

            const claimed = await store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-recovery',
                now: dueAt,
                leaseExpiresAt: dueAt + leaseDuration,
            })
            expect(claimed).not.toBeNull()
            if (claimed === null) return
            expect(claimed.recordKey).toBe('comment1')

            expect(await store.deliveries.recoverExpiredClaims(dueAt + leaseDuration)).toEqual({
                requeuedJobIds: [claimed.id],
                ambiguousJobIds: [],
            })
            expect(await readRow(fixture)).toMatchObject({
                state: 'pending',
                dueAt,
                recordKey: 'comment1',
                rootUri,
                attempts: 1,
            })

            const reclaimed = await store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-recovery-second',
                now: dueAt + leaseDuration,
                leaseExpiresAt: dueAt + leaseDuration + leaseDuration,
            })
            expect(reclaimed).not.toBeNull()
            if (reclaimed === null) return
            expect(
                await store.deliveries.startExternalEffect(
                    reclaimed.id,
                    'claim-recovery-second',
                    dueAt + leaseDuration + 1
                )
            ).toBe(true)
            expect(await store.deliveries.recoverExpiredClaims(dueAt + 2 * leaseDuration)).toEqual({
                requeuedJobIds: [],
                ambiguousJobIds: [reclaimed.id],
            })
            expect(await readRow(fixture)).toMatchObject({ state: 'ambiguous' })
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('keeps an uncertain outcome ambiguous and never sends a terminal comment again', async () => {
        const fixture = await createFixture('ambiguity')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture)
            await publishNatively(fixture, { publishedAt: now + 1 })
            await store.reconcile(now + 1)
            const dueAt = now + 1 + 300_000

            const claimed = await store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-ambiguous',
                now: dueAt,
                leaseExpiresAt: dueAt + leaseDuration,
            })
            expect(claimed).not.toBeNull()
            if (claimed === null) return
            expect(
                await store.deliveries.startExternalEffect(claimed.id, 'claim-ambiguous', dueAt + 1)
            ).toBe(true)
            expect(
                await store.deliveries.completeExternalEffect({
                    jobId: claimed.id,
                    claimToken: 'claim-ambiguous',
                    completedAt: dueAt + 2,
                    outcome: {
                        type: 'ambiguous',
                        errorMessage: 'The provider response was lost',
                    },
                })
            ).toBe('ambiguous')
            expect(await readRow(fixture)).toMatchObject({
                state: 'ambiguous',
                lastError: 'The provider response was lost',
            })
            expect(
                await store.deliveries.claimNextDueJob({
                    actorId: fixture.editorActorId,
                    claimToken: 'claim-after-ambiguous',
                    now: dueAt + 3,
                    leaseExpiresAt: dueAt + 3 + leaseDuration,
                })
            ).toBeNull()
            expect(
                await store.deliveries.completeExternalEffect({
                    jobId: claimed.id,
                    claimToken: 'claim-ambiguous',
                    completedAt: dueAt + 4,
                    outcome: { type: 'published', externalId: 'remote-1' },
                })
            ).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('records a confirmed send and freezes the comment', async () => {
        const fixture = await createFixture('sent')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture)
            await publishNatively(fixture, { publishedAt: now + 1 })
            await store.reconcile(now + 1)
            const dueAt = now + 1 + 300_000

            const claimed = await store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-sent',
                now: dueAt,
                leaseExpiresAt: dueAt + leaseDuration,
            })
            expect(claimed).not.toBeNull()
            if (claimed === null) return
            expect(
                await store.deliveries.startExternalEffect(claimed.id, 'claim-sent', dueAt + 1)
            ).toBe(true)
            expect(
                await store.deliveries.completeExternalEffect({
                    jobId: claimed.id,
                    claimToken: 'claim-sent',
                    completedAt: dueAt + 2,
                    outcome: {
                        type: 'published',
                        externalId: 'at://did:plc:bluesky-operator/app.bsky.feed.post/comment1',
                        externalUrl:
                            'https://bsky.app/profile/did:plc:bluesky-operator/app.bsky.feed.post/comment1',
                    },
                })
            ).toBe('published')
            expect(await readRow(fixture)).toMatchObject({
                state: 'sent',
                externalId: 'at://did:plc:bluesky-operator/app.bsky.feed.post/comment1',
                lastError: null,
            })
            expect(
                await saveComment(fixture, { expectedRevision: 1, text: 'Another attempt' })
            ).toEqual({
                kind: 'conflict',
            })
            // A retried identical save of the sent comment is the same request,
            // so the terminal row is returned instead of reopening the comment.
            const retried = await saveComment(fixture, { expectedRevision: 0 })
            expect(retried.kind).toBe('saved')
            if (retried.kind !== 'saved') return
            expect(retried.firstComment).toMatchObject({ state: 'sent', revision: 1 })
            expect(await store.getNextEventAt()).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('suspends a claimed comment whose enabling editor lost access before the effect', async () => {
        const fixture = await createFixture('claim-suspend')

        try {
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies,
            })
            await saveComment(fixture)
            await publishNatively(fixture, { publishedAt: now + 1 })
            await store.reconcile(now + 1)
            const dueAt = now + 1 + 300_000

            const claimed = await store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-suspend',
                now: dueAt,
                leaseExpiresAt: dueAt + leaseDuration,
            })
            expect(claimed).not.toBeNull()

            await fixture.database.sql
                .statement(
                    'delete from "project_user_grants" where "project_user_grants"."id" = ?1'
                )
                .run(`grant:${fixture.projectId}:${fixture.editorSubjectId}`)

            expect(
                await store.deliveries.startExternalEffect(claimed!.id, 'claim-suspend', dueAt + 1)
            ).toBe(false)
            expect(await readRow(fixture)).toMatchObject({
                state: 'suspended',
                lastError: 'The enabling editor no longer has editor access',
            })
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })
})

describe('publication first comment store (mastodon)', () => {
    it('prepares a Mastodon comment without any publisher connection', async () => {
        const fixture = await createFixture('mastodon-prepare', 'mastodon')

        try {
            await fixture.database.sql
                .statement(
                    'delete from "publisher_connections" where "publisher_connections"."id" = ?1'
                )
                .run(fixture.connectionId)

            const store = createStore(fixture)
            expect(await store.canConfigure(fixture.projectId, fixture.publicationId)).toBe(true)

            const created = await saveComment(fixture)
            expect(created.kind).toBe('saved')
            if (created.kind !== 'saved') return
            expect(created.firstComment).toMatchObject({
                providerId: 'mastodon',
                instanceOrigin: null,
                state: 'waiting',
                dueAt: null,
                rootUri: null,
                executionRevisionId: null,
                connectionId: null,
                credentialId: null,
                accountId: null,
            })
            expect(await store.getNextEventAt(now)).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('arms a native Mastodon receipt and binds the publishing instance', async () => {
        const fixture = await createFixture('mastodon-native', 'mastodon')

        try {
            const store = createStore(fixture)
            await saveComment(fixture, { delaySeconds: 300 })

            const publishedAt = now + 1_000
            await publishNatively(fixture, { publishedAt })

            // The confirmed receipt must wake the worker even though the
            // comment is still waiting.
            expect(await store.getNextEventAt(now)).toBe(now)

            await store.reconcile(publishedAt)

            expect(await readRow(fixture)).toMatchObject({
                state: 'pending',
                providerId: 'mastodon',
                instanceOrigin: mastodonOrigin,
                rootUri: mastodonRootUri,
                accountId: mastodonAccountId,
                connectionId: fixture.connectionId,
                credentialId: fixture.credentialId,
                executionRevisionId: fixture.executionRevisionId,
                dueAt: publishedAt + 300_000,
                revision: 1,
            })
            expect(await store.getNextEventAt(now)).toBe(publishedAt + 300_000)
            expect(await journalActions(fixture)).toEqual([
                'publication_first_comment.requested',
                'publication_first_comment.armed',
            ])
            expect(await foreignKeyViolations(fixture.database)).toEqual([])
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('refuses a parent that belongs to another instance', async () => {
        const fixture = await createFixture('mastodon-instance', 'mastodon')

        try {
            const store = createStore(fixture)
            await saveComment(fixture)

            const publishedAt = now + 1_000
            // The same numeric status and account exist on another instance.
            await publishNatively(fixture, {
                publishedAt,
                statusId: mastodonStatusId,
                permalink: `https://other.example/@owner/${mastodonStatusId}`,
            })

            await store.reconcile(publishedAt)
            expect(await readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The original connection is no longer available',
                rootUri: null,
                instanceOrigin: null,
                accountId: null,
                connectionId: null,
            })
            expect(await store.getNextEventAt(now)).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('fails a replaced account and a credential that cannot write statuses', async () => {
        const replaced = await createFixture('mastodon-replaced', 'mastodon')

        try {
            const store = createStore(replaced)
            await saveComment(replaced)
            const publishedAt = now + 1_000
            await publishNatively(replaced, { publishedAt })
            await store.reconcile(publishedAt)
            expect(await readRow(replaced)).toMatchObject({
                state: 'pending',
                accountId: mastodonAccountId,
            })

            await replaced.database.sql
                .statement(
                    'update "publisher_credentials" set "external_account_id" = ?1 where "publisher_credentials"."id" = ?2'
                )
                .run('11', replaced.credentialId)

            await store.reconcile(publishedAt + 1)
            expect(await readRow(replaced)).toMatchObject({
                state: 'failed',
                lastError: 'The original account is no longer available',
            })
            expect(await store.getNextEventAt(now)).toBeNull()
        } finally {
            await closeTestDatabase(replaced.database)
        }

        const scoped = await createFixture('mastodon-scope', 'mastodon')

        try {
            const store = createStore(scoped)
            await saveComment(scoped)
            await scoped.database.sql
                .statement(
                    'update "publisher_credentials" set "scopes" = ?1 where "publisher_credentials"."id" = ?2'
                )
                .run(toDbValue('json', ['read:accounts']), scoped.credentialId)

            const publishedAt = now + 1_000
            await publishNatively(scoped, { publishedAt })

            await store.reconcile(publishedAt)
            expect(await readRow(scoped)).toMatchObject({
                state: 'failed',
                lastError: 'The original account is no longer available',
                rootUri: null,
                accountId: null,
            })
            expect(await store.getNextEventAt(now)).toBeNull()
        } finally {
            await closeTestDatabase(scoped.database)
        }
    })

    it('fails closed without a reference parser instead of waiting for one', async () => {
        const fixture = await createFixture('mastodon-parser', 'mastodon')

        try {
            const store = createStore(fixture, { withParser: false })
            const saved = await store.save({
                projectId: fixture.projectId,
                publicationId: fixture.publicationId,
                subjectId: fixture.editorSubjectId,
                text: 'Thanks for the update',
                delaySeconds: 300,
                expectedRevision: 0,
                recordKey: 'comment1',
                now,
            })
            expect(saved.kind).toBe('saved')

            const publishedAt = now + 1_000
            await publishNatively(fixture, { publishedAt })
            expect(await store.getNextEventAt(now)).toBe(now)

            await store.reconcile(publishedAt)
            expect(await readRow(fixture)).toMatchObject({
                state: 'failed',
                lastError: 'The confirmed publication could not be resolved',
                rootUri: null,
                instanceOrigin: null,
                accountId: null,
            })
            // The terminal comment leaves the schedule instead of waking the
            // worker forever.
            expect(await store.getNextEventAt(now)).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('stops the timer when the receipt or the connection disappears', async () => {
        const receipt = await createFixture('mastodon-receipt', 'mastodon')

        try {
            const store = createStore(receipt)
            await saveComment(receipt)
            const publishedAt = now + 1_000
            await publishNatively(receipt, { publishedAt })
            await store.reconcile(publishedAt)
            expect(await readRow(receipt)).toMatchObject({ state: 'pending' })

            await receipt.database.sql
                .statement(
                    'update "jobs" set "state" = ?1, "error_message" = ?2 where "jobs"."id" = ?3'
                )
                .run('failed', 'The delivery was retried', receipt.jobId)

            await store.reconcile(publishedAt + 1)
            expect(await readRow(receipt)).toMatchObject({
                state: 'failed',
                lastError: 'The confirmed publication receipt is no longer available',
            })
            expect(await store.getNextEventAt(now)).toBeNull()
        } finally {
            await closeTestDatabase(receipt.database)
        }

        const connection = await createFixture('mastodon-connection', 'mastodon')

        try {
            const store = createStore(connection)
            await saveComment(connection)
            const publishedAt = now + 1_000
            await publishNatively(connection, { publishedAt })
            await store.reconcile(publishedAt)
            expect(await readRow(connection)).toMatchObject({ state: 'pending' })

            await connection.database.sql
                .statement(
                    'delete from "publisher_connections" where "publisher_connections"."id" = ?1'
                )
                .run(connection.connectionId)

            await store.reconcile(publishedAt + 1)
            expect(await readRow(connection)).toMatchObject({
                state: 'failed',
                lastError: 'The original connection is no longer available',
            })
            expect(await store.getNextEventAt(now)).toBeNull()
        } finally {
            await closeTestDatabase(connection.database)
        }
    })

    it('accepts the conservative 500 unit reply envelope', async () => {
        const fixture = await createFixture('mastodon-text', 'mastodon')

        try {
            // Mastodon keeps its own envelope, so a comment that the Bluesky
            // grapheme limit would refuse is accepted here.
            expect((await saveComment(fixture, { text: 'a'.repeat(400) })).kind).toBe('saved')
            await expect(saveComment(fixture, { text: 'a'.repeat(501) })).rejects.toThrow(
                'must not exceed 500 UTF-16 code units'
            )
            await expect(saveComment(fixture, { text: '   ' })).rejects.toThrow('must not be blank')
        } finally {
            await closeTestDatabase(fixture.database)
        }

        const bluesky = await createFixture('bluesky-text')

        try {
            await expect(saveComment(bluesky, { text: 'a'.repeat(400) })).rejects.toThrow(
                'must not exceed 300 graphemes'
            )
        } finally {
            await closeTestDatabase(bluesky.database)
        }
    })

    it('re-enables a suspended Mastodon comment from the current revision', async () => {
        const fixture = await createFixture('mastodon-suspend', 'mastodon')

        try {
            const store = createStore(fixture)
            await saveComment(fixture)
            const publishedAt = now + 1_000
            await publishNatively(fixture, { publishedAt })
            await store.reconcile(publishedAt)
            expect(await readRow(fixture)).toMatchObject({
                state: 'pending',
                instanceOrigin: mastodonOrigin,
                rootUri: mastodonRootUri,
            })

            await fixture.database.sql
                .statement(
                    'delete from "project_user_grants" where "project_user_grants"."id" = ?1'
                )
                .run(`grant:${fixture.projectId}:${fixture.editorSubjectId}`)
            await store.reconcile(publishedAt + 1)
            expect(await readRow(fixture)).toMatchObject({ state: 'suspended', revision: 1 })

            // A stale revision can never lift the suspension.
            expect(
                (
                    await saveComment(fixture, {
                        subjectId: fixture.otherEditorSubjectId,
                        expectedRevision: 0,
                        text: 'An edited comment',
                    })
                ).kind
            ).toBe('conflict')

            const reenabled = await saveComment(fixture, {
                subjectId: fixture.otherEditorSubjectId,
                expectedRevision: 1,
                text: 'An edited comment',
            })
            expect(reenabled.kind).toBe('saved')
            if (reenabled.kind !== 'saved') return
            expect(reenabled.firstComment).toMatchObject({
                state: 'pending',
                revision: 2,
                providerId: 'mastodon',
                instanceOrigin: mastodonOrigin,
                rootUri: mastodonRootUri,
                accountId: mastodonAccountId,
                actorId: fixture.otherEditorActorId,
                recordKey: 'comment1',
                lastError: null,
            })
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('keeps the claim fence, the cancellation and the uncertainty of a send', async () => {
        const fixture = await createFixture('mastodon-fence', 'mastodon')

        try {
            const store = createStore(fixture)
            await saveComment(fixture)
            await publishNatively(fixture, { publishedAt: now + 1 })
            await store.reconcile(now + 1)
            const dueAt = now + 1 + 300_000

            const claimed = await store.deliveries.claimNextDueJob({
                actorId: fixture.editorActorId,
                claimToken: 'claim-mastodon',
                now: dueAt,
                leaseExpiresAt: dueAt + leaseDuration,
            })
            expect(claimed).not.toBeNull()
            if (claimed === null) return

            // A cancellation cannot take a claimed comment.
            expect(
                await store.cancel({
                    projectId: fixture.projectId,
                    publicationId: fixture.publicationId,
                    subjectId: fixture.editorSubjectId,
                    expectedRevision: 1,
                    now: dueAt + 1,
                })
            ).toEqual({ kind: 'conflict' })

            expect(
                await store.deliveries.startExternalEffect(claimed.id, 'claim-mastodon', dueAt + 1)
            ).toBe(true)
            expect(
                await store.deliveries.completeExternalEffect({
                    jobId: claimed.id,
                    claimToken: 'claim-mastodon',
                    completedAt: dueAt + 2,
                    outcome: {
                        type: 'ambiguous',
                        errorMessage: 'The provider response was lost',
                    },
                })
            ).toBe('ambiguous')
            expect(await readRow(fixture)).toMatchObject({
                state: 'ambiguous',
                lastError: 'The provider response was lost',
            })
            expect(
                await store.deliveries.claimNextDueJob({
                    actorId: fixture.editorActorId,
                    claimToken: 'claim-after-ambiguous',
                    now: dueAt + 3,
                    leaseExpiresAt: dueAt + 3 + leaseDuration,
                })
            ).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }

        const cancelled = await createFixture('mastodon-cancel', 'mastodon')

        try {
            const store = createStore(cancelled)
            await saveComment(cancelled)
            const cancelledRow = await store.cancel({
                projectId: cancelled.projectId,
                publicationId: cancelled.publicationId,
                subjectId: cancelled.editorSubjectId,
                expectedRevision: 1,
                now: now + 2,
            })
            expect(cancelledRow.kind).toBe('saved')
            expect(
                await store.deliveries.claimNextDueJob({
                    actorId: cancelled.editorActorId,
                    claimToken: 'claim-after-cancel',
                    now: now + 1 + 300_000,
                    leaseExpiresAt: now + 1 + 300_000 + leaseDuration,
                })
            ).toBeNull()
        } finally {
            await closeTestDatabase(cancelled.database)
        }
    })

    it('pins the provider and refuses an edit that would change it', async () => {
        const fixture = await createFixture('mastodon-provider', 'mastodon')

        try {
            const created = await saveComment(fixture)
            expect(created.kind).toBe('saved')
            if (created.kind !== 'saved') return
            expect(created.firstComment.providerId).toBe('mastodon')

            // The channel now publishes with another contract.
            await fixture.database.sql
                .statement(
                    'update "channel_profile_versions" set "profile_id" = ?1, "profile_json" = ?2, "profile_hash" = ?3, "schema_hash" = ?4 where "channel_profile_versions"."id" = ?5'
                )
                .run(
                    blueskyProfile.id,
                    toDbValue('json', blueskyProfile),
                    blueskyProfile.profileHash,
                    blueskyProfile.schemaHash,
                    fixture.profileVersionId
                )

            expect(
                await saveComment(fixture, { expectedRevision: 1, text: 'An edited comment' })
            ).toEqual({ kind: 'conflict' })
            expect(await readRow(fixture)).toMatchObject({
                providerId: 'mastodon',
                revision: 1,
                text: 'Thanks for the update',
            })
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('never arms a receipt produced by another provider', async () => {
        const fixture = await createFixture('mastodon-wrong-receipt', 'mastodon')

        try {
            const store = createStore(fixture)
            await saveComment(fixture)

            const blueskyProfileVersionId = 'profile-bluesky-wrong-receipt'
            await fixture.database.sql
                .statement(
                    'insert into "channel_profile_versions" ("id", "workspace_id", "channel_id", "profile_id", "version", "origin", "state", "profile_json", "profile_hash", "schema_hash", "created_by_actor_id") values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)'
                )
                .run(
                    blueskyProfileVersionId,
                    await workspaceOf(fixture.database, fixture.projectId),
                    fixture.channelId,
                    blueskyProfile.id,
                    3,
                    blueskyProfile.origin,
                    'superseded',
                    toDbValue('json', blueskyProfile),
                    blueskyProfile.profileHash,
                    blueskyProfile.schemaHash,
                    fixture.workspaceActorId
                )

            const publishedAt = now + 1_000
            await publishNatively(fixture, { publishedAt })
            await fixture.database.sql
                .statement(
                    'update "publication_execution_revisions" set "profile_version_id" = ?1 where "publication_execution_revisions"."id" = ?2'
                )
                .run(blueskyProfileVersionId, fixture.executionRevisionId)

            await store.reconcile(publishedAt)
            expect(await readRow(fixture)).toMatchObject({
                state: 'waiting',
                rootUri: null,
                instanceOrigin: null,
                accountId: null,
            })
            expect(await store.getNextEventAt(now)).toBeNull()
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it('leaves Bluesky comments untouched by the Mastodon parser', async () => {
        const fixture = await createFixture('bluesky-parser')

        try {
            let parserCalls = 0
            const store = createPublicationFirstCommentStore(fixture.database, {
                policies: providerCommentPolicies.map(policy =>
                    policy.id === 'mastodon'
                        ? createMastodonCommentPolicy((externalId, externalUrl) => {
                              parserCalls += 1
                              return resolveMastodonStatusReference(externalId, externalUrl)
                          })
                        : policy
                ),
            })
            await store.save({
                projectId: fixture.projectId,
                publicationId: fixture.publicationId,
                subjectId: fixture.editorSubjectId,
                text: 'Thanks for the update',
                delaySeconds: 300,
                expectedRevision: 0,
                recordKey: 'comment1',
                now,
            })
            const publishedAt = now + 1_000
            await publishNatively(fixture, { publishedAt })
            await store.reconcile(publishedAt)

            expect(await readRow(fixture)).toMatchObject({
                state: 'pending',
                providerId: 'bluesky',
                instanceOrigin: null,
                rootUri,
                accountId: accountDid,
            })
            expect(parserCalls).toBe(0)
        } finally {
            await closeTestDatabase(fixture.database)
        }
    })

    it.skipIf(testEngine === 'postgres')(
        'keeps historical Bluesky comments when the provider column is added',
        async () => {
            const folder = mkdtempSync(join(tmpdir(), 'postdot-first-comment-migration-'))

            try {
                // The committed history without the provider column.
                const journal = JSON.parse(
                    readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')
                ) as { entries: { idx: number; tag: string }[] }
                const historical = {
                    ...journal,
                    entries: journal.entries.filter(entry => entry.idx < 18),
                }
                mkdirSync(join(folder, 'meta'))
                for (const entry of historical.entries) {
                    writeFileSync(
                        join(folder, `${entry.tag}.sql`),
                        readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url))
                    )
                }
                writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(historical))

                const fixture = await createFixture('historical', 'bluesky', {
                    migrationsFolder: folder,
                })

                await fixture.database.sql
                    .statement(
                        `insert into publication_first_comments
                        (id, project_id, publication_id, actor_id, text, delay_seconds, state,
                         revision, record_key, attempts, created_at, updated_at)
                     values (?1, ?2, ?3, ?4, ?5, ?6, 'sent', 1, ?7, 1, ?8, ?8)`
                    )
                    .run(
                        'historical-comment',
                        fixture.projectId,
                        fixture.publicationId,
                        fixture.editorActorId,
                        'A historical Bluesky comment',
                        300,
                        'historical-comment',
                        now
                    )

                // The provider column is added by the committed migration.
                runMigrations(fixture.database as PostdotDatabase)

                const row = await fixture.database.sql
                    .statement<
                        {
                            readonly providerId: string
                            readonly instanceOrigin: string | null
                            readonly text: string
                            readonly state: string
                            readonly revision: number
                        },
                        [string]
                    >(
                        `select provider_id as providerId,
                            instance_origin as instanceOrigin,
                            text,
                            state,
                            revision
                     from publication_first_comments
                     where id = ?1`
                    )
                    .get('historical-comment')

                expect(row).toEqual({
                    providerId: 'bluesky',
                    instanceOrigin: null,
                    text: 'A historical Bluesky comment',
                    state: 'sent',
                    revision: 1,
                })
                expect(await foreignKeyViolations(fixture.database)).toEqual([])
            } finally {
                rmSync(folder, { recursive: true, force: true })
            }
        }
    )
})

it('uses a synthetic provider policy while retaining access, receipt and claim fences', async () => {
    const fixture = await createFixture('synthetic-policy')
    try {
        const baseline = providerCommentPolicies.find(policy => policy.id === 'bluesky')!
        const policy = {
            ...baseline,
            id: 'synthetic',
            normalizeText: (text: string) => baseline.normalizeText(text.toUpperCase()),
        }
        const store = createPublicationFirstCommentStore(fixture.database, { policies: [policy] })
        const profile = {
            ...blueskyProfile,
            execution: { ...blueskyProfile.execution, contractId: policy.id },
        }
        await fixture.database.sql
            .statement(
                'update "channel_profile_versions" set "profile_json" = ?1 where "channel_profile_versions"."id" = ?2'
            )
            .run(toDbValue('json', profile), fixture.profileVersionId)
        await fixture.database.sql.statement('update "publishers" set "kind" = ?1').run(policy.id)
        await fixture.database.sql
            .statement('update "publisher_credentials" set "provider_id" = ?1')
            .run(policy.id)
        const input = {
            projectId: fixture.projectId,
            publicationId: fixture.publicationId,
            subjectId: fixture.editorSubjectId,
            text: 'A synthetic comment',
            delaySeconds: 0,
            expectedRevision: 0,
            recordKey: 'synthetic-key',
            now,
        }
        expect(await store.save({ ...input, subjectId: fixture.viewerSubjectId })).toEqual({
            kind: 'not_found',
        })
        const saved = await store.save(input)
        expect(saved.kind).toBe('saved')
        expect(await readRow(fixture)).toMatchObject({
            providerId: 'synthetic',
            text: 'A SYNTHETIC COMMENT',
            state: 'waiting',
        })
        await publishNatively(fixture, { publishedAt: now + 1 })
        await store.reconcile(now + 1)
        expect(await readRow(fixture)).toMatchObject({
            providerId: 'synthetic',
            state: 'pending',
            rootUri,
            accountId: accountDid,
        })
        const claim = await store.deliveries.claimNextDueJob({
            actorId: fixture.editorActorId,
            claimToken: 'synthetic-claim',
            now: now + 1,
            leaseExpiresAt: now + 1 + leaseDuration,
        })
        expect(claim).not.toBeNull()
        if (!claim) return
        expect(await store.claimCurrent(claim, now + 2)).toBe(true)
        await fixture.database.sql
            .statement('update "publisher_credentials" set "state" = ?1')
            .run('reconnect_required')
        expect(await store.claimCurrent(claim, now + 3)).toBe(false)
        expect(await foreignKeyViolations(fixture.database)).toEqual([])
    } finally {
        await closeTestDatabase(fixture.database)
    }
})
