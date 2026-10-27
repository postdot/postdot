import { createManualChannelProfile } from '@postdot/core'

import type { PostbotDatabase } from './client'
import type { CreateAuthorizationAttemptInput } from './oauth-authorization-attempt-store'
import type { PublisherCredentialCipher } from './publisher-credential-crypto'

/** Historical migration tests must seed historical columns, not today's application stores/schema. */
export function seedLegacyProjectChannel(database: PostbotDatabase, subjectId: string, at: number) {
    const project = { id: 'legacy-project' }
    const actor = { id: 'legacy-actor' }
    const channel = { id: 'legacy-channel' }
    const profile = createManualChannelProfile()
    database.$client
        .query("insert into projects (id,name,created_at,updated_at) values (?,'Project',?,?)")
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
    database: PostbotDatabase,
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
    database: PostbotDatabase,
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
