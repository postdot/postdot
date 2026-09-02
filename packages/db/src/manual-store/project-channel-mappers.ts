import type { Channel, Project } from '@herald/core'

import type { ChannelRow, ProjectRow } from './rows'

export function toProject(row: ProjectRow): Project {
    return {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

export function toChannel(row: ChannelRow): Channel {
    return {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        profileId: row.profileId,
        profileVersionId: row.profileVersionId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}
