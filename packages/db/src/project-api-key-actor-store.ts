import { requireNonBlank, requireTimestamp } from '@herald/core'

import type { HeraldDatabase } from './client'

export interface CreateProjectApiKeyActorInput {
    readonly projectId: string
    readonly keyId: string
    readonly name: string
    readonly now?: number
}

export interface ProjectApiKeyActor {
    readonly id: string
    readonly projectId: string
    readonly subjectId: string
    readonly displayName: string
}

/**
 * Keeps a Better Auth organization API key connected to Herald's operational
 * actor model. Better Auth deliberately has no project publication actor, so
 * the bridge is the only place that creates this non-human actor.
 */
export function createProjectApiKeyActorStore(database: HeraldDatabase) {
    const client = database.$client
    const projectExistsStatement = client.query<{ readonly id: string }, [string]>(
        'select id from projects where id = ?1'
    )
    const insertActorStatement = client.query<
        void,
        [id: string, projectId: string, subjectId: string, displayName: string, now: number]
    >(`
        insert into actors (id, project_id, kind, subject_id, display_name, created_at, updated_at)
        values (?1, ?2, 'api_token', ?3, ?4, ?5, ?5)
    `)

    return {
        create(input: CreateProjectApiKeyActorInput): ProjectApiKeyActor | null {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const keyId = requireNonBlank(input.keyId, 'keyId')
            const name = requireNonBlank(input.name, 'name')
            if (projectExistsStatement.get(projectId) === null) return null

            const id = `api-key:${keyId}`
            const subjectId = id
            const displayName = `API key: ${name}`
            const timestamp = requireTimestamp(input.now ?? Date.now(), 'now')
            insertActorStatement.run(id, projectId, subjectId, displayName, timestamp)
            return { id, projectId, subjectId, displayName }
        },
    }
}

export type ProjectApiKeyActorStore = ReturnType<typeof createProjectApiKeyActorStore>
