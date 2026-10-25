import { api } from './api'

export async function loadProjectShell(projectId: string) {
    const [channels, connections, membership] = await Promise.all([
        api.listChannels(projectId),
        api.listPublisherConnections(projectId),
        api.getProjectMembership(projectId),
    ])
    return { channels, connections, membership }
}
