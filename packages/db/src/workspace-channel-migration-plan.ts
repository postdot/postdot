import type { PostbotDatabase } from './client'

const resourceTables = {
    channels: 'channels',
    profiles: 'channel_profile_versions',
    publishers: 'publishers',
    credentials: 'publisher_credentials',
    connections: 'publisher_connections',
} as const

export interface WorkspaceChannelResourceOwner {
    readonly id: string
    readonly projectId: string
    readonly workspaceId: string
}

export type WorkspaceChannelMigrationPlan = {
    readonly [Kind in keyof typeof resourceTables]: readonly WorkspaceChannelResourceOwner[]
}

/** Plan the legacy ownership conversion. Never assign a default or merge independent records. */
export function planWorkspaceChannelMigration(
    database: PostbotDatabase
): WorkspaceChannelMigrationPlan {
    const client = database.$client
    const violations = client
        .query<{ table: string; rowid: number; parent: string; fkid: number }, []>(
            'pragma foreign_key_check'
        )
        .all()
    if (violations.length)
        throw new Error(
            `Channel ownership preflight found foreign-key violations: ${JSON.stringify(violations)}`
        )
    const projects = client
        .query<{ id: string; workspaceId: string | null }, []>(`
        select p.id, w.id as workspaceId from projects p
        left join workspaces w on w.id = p.workspace_id order by p.id
    `)
        .all()
    const unresolved = projects
        .filter(project => project.workspaceId === null)
        .map(project => project.id)
    if (unresolved.length)
        throw new Error(
            `Channel ownership migration requires explicit workspace assignment for projects: ${unresolved.join(', ')}`
        )
    const workspaces = new Map(projects.map(project => [project.id, project.workspaceId]))
    const owners = (table: string): WorkspaceChannelResourceOwner[] =>
        client
            .query<{ id: string; projectId: string }, []>(
                `select id, project_id as projectId from ${table} order by id`
            )
            .all()
            .map(row => {
                const workspaceId = workspaces.get(row.projectId)
                if (workspaceId === undefined || workspaceId === null)
                    throw new Error(
                        `Channel ownership cannot be resolved for ${table} record ${row.id}`
                    )
                return { ...row, workspaceId }
            })
    // Only identifiers are read. In particular, do not load tokens, encrypted
    // envelopes, display names or endpoint configuration into a readiness report.
    return {
        channels: owners(resourceTables.channels),
        profiles: owners(resourceTables.profiles),
        publishers: owners(resourceTables.publishers),
        credentials: owners(resourceTables.credentials),
        connections: owners(resourceTables.connections),
    }
}
