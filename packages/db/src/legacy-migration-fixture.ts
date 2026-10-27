import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createManualChannelProfile } from '@postdot/core'

import type { PostdotDatabase } from './client'
import { defaultMigrationsFolder } from './migrations'
import type { CreateAuthorizationAttemptInput } from './oauth-authorization-attempt-store'
import type { PublisherCredentialCipher } from './publisher-credential-crypto'

/** Historical migration tests must seed historical columns, not today's application stores/schema. */
export function seedLegacyProjectChannel(database: PostdotDatabase, subjectId: string, at: number) {
    const project = { id: 'legacy-project' }
    const actor = { id: 'legacy-actor' }
    const channel = { id: 'legacy-channel' }
    const profile = createManualChannelProfile()
    // The ownership upgrade refuses a project without a workspace, so the historical project has one.
    database.$client
        .query(
            "insert into organization (id,name,slug,created_at) values ('legacy-organization','Legacy','legacy',?)"
        )
        .run(at)
    database.$client
        .query(
            "insert into workspaces (id,organization_id,name,slug,created_at,updated_at) values ('legacy-workspace','legacy-organization','Legacy','legacy',?,?)"
        )
        .run(at, at)
    database.$client
        .query(
            "insert into projects (id,name,workspace_id,created_at,updated_at) values (?,'Project','legacy-workspace',?,?)"
        )
        .run(project.id, at, at)
    database.$client
        .query(
            "insert into actors (id,project_id,kind,subject_id,display_name,created_at,updated_at) values (?,?,'human',?,'Owner',?,?)"
        )
        .run(actor.id, project.id, subjectId, at, at)
    database.$client
        .query(
            "insert into channels (id,project_id,name,profile_version_id,created_at,updated_at) values (?,?,'Channel','legacy-profile',?,?)"
        )
        .run(channel.id, project.id, at, at)
    database.$client
        .query(`insert into channel_profile_versions (id,project_id,channel_id,profile_id,version,origin,state,revision,profile_json,profile_hash,schema_hash,created_by_actor_id,created_at,updated_at)
        values ('legacy-profile',?,?,?,1,'built_in','active',1,?,?,?,?,?,?)`)
        .run(
            project.id,
            channel.id,
            profile.id,
            JSON.stringify(profile),
            profile.profileHash,
            profile.schemaHash,
            actor.id,
            at,
            at
        )
    return { project, actor, channel }
}

export function seedLegacyPublication(
    database: PostdotDatabase,
    fixture: ReturnType<typeof seedLegacyProjectChannel>,
    at: number
) {
    const { project, actor, channel } = fixture
    const source = JSON.stringify({ body: { format: 'plain_text', text: 'Source' }, media: [] })
    database.$client
        .query(
            "insert into posts (id,project_id,source_content,source_revision,created_by_actor_id,created_at,updated_at) values ('legacy-post',?,?,1,?,?,?)"
        )
        .run(project.id, source, actor.id, at, at)
    database.$client
        .query(`insert into publications (id,project_id,post_id,channel_id,delivery_mode,review_state,state,created_by_actor_id,state_changed_by_actor_id,created_at,updated_at)
        values ('legacy-publication',?,'legacy-post',?,'manual','compatible','draft',?,?,?,?)`)
        .run(project.id, channel.id, actor.id, actor.id, at, at)
    const profile = createManualChannelProfile()
    database.$client
        .query(`insert into publication_target_revisions
        (id,project_id,publication_id,sequence,profile_version_id,source_revision,delivery_mode,content_json,content_hash,profile_hash,schema_hash,validation_issues_json,created_by_actor_id,created_at)
        values ('legacy-target',?,'legacy-publication',1,'legacy-profile',1,'manual',?,'legacy-content-hash',?,?,'[]',?,?)`)
        .run(
            project.id,
            JSON.stringify({ body: 'Source', media: [] }),
            profile.profileHash,
            profile.schemaHash,
            actor.id,
            at
        )
    database.$client
        .query(
            "update publications set target_revision_id = 'legacy-target' where id = 'legacy-publication'"
        )
        .run()
    return { id: 'legacy-publication' }
}

/** Seed historical columns without constructing today's read-contract-dependent stores. */
export async function seedLegacyAuthorizationAttempt(
    database: PostdotDatabase,
    input: CreateAuthorizationAttemptInput,
    cipher: PublisherCredentialCipher,
    now: number
) {
    const id = 'legacy-authorization-attempt'
    const verifier =
        input.codeVerifier === null
            ? null
            : await cipher.encrypt(
                  { recordId: id, providerId: input.providerId, field: 'pkce_verifier' },
                  input.codeVerifier
              )
    const state =
        input.providerState == null
            ? null
            : await cipher.encrypt(
                  { recordId: id, providerId: input.providerId, field: 'provider_state' },
                  input.providerState
              )
    database.$client
        .query(`insert into oauth_authorization_attempts
        (id,project_id,channel_id,connected_by_actor_id,provider_id,provider_application_id,callback_uri,scopes,return_path,state_digest,pkce_encryption_version,pkce_encryption_key_id,pkce_verifier_ciphertext,pkce_verifier_nonce,provider_state_encryption_version,provider_state_encryption_key_id,provider_state_ciphertext,provider_state_nonce,expires_at,created_at,updated_at)
        values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
            id,
            input.projectId,
            input.channelId,
            input.connectedByActorId,
            input.providerId,
            input.providerApplicationId ?? null,
            input.callbackUri,
            JSON.stringify(input.scopes),
            input.returnPath,
            input.stateDigest,
            verifier?.version ?? null,
            verifier?.keyId ?? null,
            verifier?.ciphertext ?? null,
            verifier?.nonce ?? null,
            state?.version ?? null,
            state?.keyId ?? null,
            state?.ciphertext ?? null,
            state?.nonce ?? null,
            now + 600000,
            now,
            now
        )
}

/** A connected, scheduled channel written with the project-owned columns that existed before the ownership conversion. */
export function seedLegacyScheduledChannel(
    database: PostdotDatabase,
    input: { readonly prefix: string; readonly workspaceId: string; readonly at: number }
) {
    const { prefix, workspaceId, at } = input
    const ids = {
        project: `${prefix}-project`,
        actor: `${prefix}-actor`,
        channel: `${prefix}-channel`,
        profile: `${prefix}-profile`,
        publisher: `${prefix}-publisher`,
        credential: `${prefix}-credential`,
        connection: `${prefix}-connection`,
        post: `${prefix}-post`,
        publication: `${prefix}-publication`,
        target: `${prefix}-target`,
        job: `${prefix}-job`,
    }
    const client = database.$client
    const profile = {
        ...createManualChannelProfile(),
        id: 'fixture',
        execution: { kind: 'built_in' as const, contractId: 'fixture', revision: 'v1' },
    }
    client
        .query(
            'insert into projects (id,name,workspace_id,created_at,updated_at) values (?,?,?,?,?)'
        )
        .run(ids.project, prefix, workspaceId, at, at)
    client
        .query(
            "insert into actors (id,project_id,kind,subject_id,display_name,created_at,updated_at) values (?,?,'human',?,?,?,?)"
        )
        .run(ids.actor, ids.project, prefix, prefix, at, at)
    client
        .query(
            'insert into channels (id,project_id,name,profile_version_id,created_at,updated_at) values (?,?,?,?,?,?)'
        )
        .run(ids.channel, ids.project, prefix, ids.profile, at, at)
    client
        .query(`insert into channel_profile_versions
            (id,project_id,channel_id,profile_id,version,origin,state,revision,profile_json,profile_hash,schema_hash,created_by_actor_id,created_at,updated_at)
            values (?,?,?,?,?,'built_in','active',1,?,?,?,?,?,?)`)
        .run(
            ids.profile,
            ids.project,
            ids.channel,
            profile.id,
            profile.version,
            JSON.stringify(profile),
            profile.profileHash,
            profile.schemaHash,
            ids.actor,
            at,
            at
        )
    client
        .query(
            'insert into publishers (id,project_id,channel_id,kind,created_at,updated_at) values (?,?,?,?,?,?)'
        )
        .run(ids.publisher, ids.project, ids.channel, 'fixture', at, at)
    // The same external account is two independent credentials; the conversion must not merge them.
    client
        .query(`insert into publisher_credentials
            (id,project_id,provider_id,external_account_id,scopes,state,connected_by_actor_id,encryption_version,encryption_key_id,access_token_ciphertext,access_token_nonce,refresh_token_ciphertext,refresh_token_nonce,provider_session_ciphertext,provider_session_nonce,created_at,updated_at)
            values (?,?,'fixture','same-account','[]','active',?,1,'fixture',?,?,?,?,?,?,?,?)`)
        .run(
            ids.credential,
            ids.project,
            ids.actor,
            Buffer.alloc(24, prefix.length),
            Buffer.alloc(12, 1),
            Buffer.alloc(24, prefix.length + 1),
            Buffer.alloc(12, 2),
            Buffer.alloc(24, prefix.length + 2),
            Buffer.alloc(12, 3),
            at,
            at
        )
    client
        .query(
            'insert into publisher_connections (id,project_id,publisher_id,credential_id,connected_by_actor_id,created_at,updated_at) values (?,?,?,?,?,?,?)'
        )
        .run(ids.connection, ids.project, ids.publisher, ids.credential, ids.actor, at, at)
    client
        .query(
            'insert into posts (id,project_id,source_content,source_revision,created_by_actor_id,created_at,updated_at) values (?,?,?,1,?,?,?)'
        )
        .run(
            ids.post,
            ids.project,
            JSON.stringify({ body: { format: 'plain_text', text: prefix }, media: [] }),
            ids.actor,
            at,
            at
        )
    client
        .query(`insert into publications (id,project_id,post_id,channel_id,delivery_mode,review_state,state,created_by_actor_id,state_changed_by_actor_id,created_at,updated_at)
            values (?,?,?,?,'automatic','compatible','draft',?,?,?,?)`)
        .run(ids.publication, ids.project, ids.post, ids.channel, ids.actor, ids.actor, at, at)
    client
        .query(`insert into publication_target_revisions
            (id,project_id,publication_id,sequence,profile_version_id,source_revision,delivery_mode,content_json,content_hash,profile_hash,schema_hash,validation_issues_json,created_by_actor_id,created_at)
            values (?,?,?,1,?,1,'automatic',?,?,?,?,'[]',?,?)`)
        .run(
            ids.target,
            ids.project,
            ids.publication,
            ids.profile,
            JSON.stringify({ body: prefix, media: [] }),
            `${prefix}-hash`,
            profile.profileHash,
            profile.schemaHash,
            ids.actor,
            at
        )
    client
        .query(
            "update publications set state = 'scheduled', target_revision_id = ?, scheduled_at = ?, scheduled_by_actor_id = ? where id = ?"
        )
        .run(ids.target, at + 60_000, ids.actor, ids.publication)
    client
        .query(
            "insert into jobs (id,project_id,publication_id,state,run_at,created_at,updated_at) values (?,?,?,'pending',?,?,?)"
        )
        .run(ids.job, ids.project, ids.publication, at + 60_000, at, at)
    return ids
}

/** Copies the committed migration chain up to and including `lastIndex`, so tests can seed a historical schema. */
export function migrationsThrough(target: string, lastIndex: number): string {
    mkdirSync(join(target, 'meta'), { recursive: true })
    const journal = JSON.parse(
        readFileSync(join(defaultMigrationsFolder, 'meta/_journal.json'), 'utf8')
    ) as { entries: { idx: number; tag: string }[] }
    const entries = journal.entries.filter(entry => entry.idx <= lastIndex)
    writeFileSync(join(target, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
    for (const entry of entries)
        copyFileSync(
            join(defaultMigrationsFolder, `${entry.tag}.sql`),
            join(target, `${entry.tag}.sql`)
        )
    return target
}
