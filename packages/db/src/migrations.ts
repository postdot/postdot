import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

import type { HeraldDatabase } from './client'

export const defaultMigrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

interface LegacyProjectMembershipCandidate {
    readonly projectId: string
    readonly actorId: string | null
    readonly subjectId: string | null
    readonly actorCreatedAt: number | null
    readonly actorUpdatedAt: number | null
    readonly userId: string | null
    readonly instanceMembershipState: string | null
}

export function runMigrations(
    database: HeraldDatabase,
    migrationsFolder = defaultMigrationsFolder
) {
    const client = database.$client
    const foreignKeysWereEnabled =
        client.query<{ readonly foreign_keys: number }, []>('PRAGMA foreign_keys').get()
            ?.foreign_keys === 1

    // SQLite cannot change this pragma from inside Drizzle's migration transaction. The
    // committed migrations already use the same bounded rebuild pattern, so disable checks
    // before Drizzle starts the transaction and validate the final schema before restoring them.
    client.run('PRAGMA foreign_keys = OFF')

    try {
        try {
            migrate(database, { migrationsFolder })
        } catch (error) {
            if (!hasExistingSchemaObject(error)) throw error

            throw new Error(
                `The database schema conflicts with the committed migration history in "${migrationsFolder}". If this is an unreleased local database, stop Herald and move the database file aside before restarting. Do not use this recovery for a database with data to preserve.`,
                { cause: error }
            )
        }

        backfillLegacyProjectMemberships(database)

        const foreignKeyViolations = client
            .query<
                {
                    readonly table: string
                    readonly rowid: number
                    readonly parent: string
                    readonly fkid: number
                },
                []
            >('PRAGMA foreign_key_check')
            .all()

        if (foreignKeyViolations.length > 0) {
            throw new Error(
                `Database migrations left foreign-key violations: ${JSON.stringify(foreignKeyViolations)}`
            )
        }
    } finally {
        client.run(`PRAGMA foreign_keys = ${foreignKeysWereEnabled ? 'ON' : 'OFF'}`)
    }
}

function backfillLegacyProjectMemberships(database: HeraldDatabase): void {
    const client = database.$client
    const loadCandidates = () =>
        client
            .query<LegacyProjectMembershipCandidate, []>(`
                select projects.id as projectId,
                       actors.id as actorId,
                       actors.subject_id as subjectId,
                       actors.created_at as actorCreatedAt,
                       actors.updated_at as actorUpdatedAt,
                       users.id as userId,
                       instance_memberships.state as instanceMembershipState
                from projects
                left join actors
                    on actors.id = (
                        select candidate.id
                        from actors as candidate
                        where candidate.project_id = projects.id
                          and candidate.kind = 'human'
                        order by candidate.created_at, candidate.id
                        limit 1
                    )
                left join user as users on users.id = actors.subject_id
                left join instance_memberships
                    on instance_memberships.user_id = actors.subject_id
                where not exists (
                    select 1
                    from project_memberships
                    where project_memberships.project_id = projects.id
                )
                order by projects.id
            `)
            .all()

    const insertMembership = client.query<
        void,
        [id: string, projectId: string, userId: string, createdAt: number, updatedAt: number]
    >(`
        insert into project_memberships (
            id, project_id, user_id, role, state, created_at, updated_at
        ) values (?1, ?2, ?3, 'owner', 'active', ?4, ?5)
        on conflict do nothing
    `)

    const backfill = client.transaction(() => {
        for (const candidate of loadCandidates()) {
            if (
                candidate.actorId === null ||
                candidate.subjectId === null ||
                candidate.userId === null ||
                candidate.instanceMembershipState !== 'enabled' ||
                candidate.actorCreatedAt === null ||
                candidate.actorUpdatedAt === null
            ) {
                continue
            }

            insertMembership.run(
                `project-membership:${candidate.projectId}:${candidate.userId}`,
                candidate.projectId,
                candidate.userId,
                candidate.actorCreatedAt,
                candidate.actorUpdatedAt
            )
        }
    })

    backfill()

    const unresolved = loadCandidates()
    if (unresolved.length === 0) return

    throw new Error(
        `Legacy project membership backfill could not recover durable owners for: ${unresolved
            .map(describeLegacyProjectMembershipCandidate)
            .join(', ')}`
    )
}

function describeLegacyProjectMembershipCandidate(
    candidate: LegacyProjectMembershipCandidate
): string {
    if (candidate.actorId === null) return `${candidate.projectId} (no human project actor)`
    if (candidate.subjectId === null) return `${candidate.projectId} (project actor has no subject)`
    if (candidate.userId === null) {
        return `${candidate.projectId} (project actor subject ${candidate.subjectId} has no user row)`
    }
    if (candidate.instanceMembershipState === null) {
        return `${candidate.projectId} (user ${candidate.userId} has no instance membership)`
    }
    if (candidate.instanceMembershipState !== 'enabled') {
        return `${candidate.projectId} (user ${candidate.userId} has a disabled instance membership)`
    }
    return `${candidate.projectId} (project actor identity is incomplete)`
}

function hasExistingSchemaObject(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    if (/already exists/i.test(error.message)) return true

    return hasExistingSchemaObject(error.cause)
}
