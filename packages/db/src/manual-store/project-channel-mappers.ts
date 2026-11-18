import type { Channel, Project } from '@postdot/core'

import type { ChannelRow, ProjectRow } from './rows'

export function toProject(row: ProjectRow): Project {
    return {
        id: row.id,
        name: row.name,
        timeZone: row.timeZone,
        workspaceId: row.workspaceId,
        primaryCategoryId: row.primaryCategoryId,
        websiteUrl: row.websiteUrl ?? null,
        imageUrl: row.imageUrl ?? null,
        imageSource: row.imageSource ?? null,
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
        state: row.state,
        archivedAt: row.archivedAt,
        revision: row.revision,
        websiteUrl: row.websiteUrl ?? null,
        imageUrl: row.imageUrl ?? null,
        imageSource: row.imageSource ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}
