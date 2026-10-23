export const projectQueryKeys = {
    data: (projectId: string) => ['project', projectId, 'data'] as const,
    channels: (projectId: string) => [...projectQueryKeys.data(projectId), 'channels'] as const,
    connections: (projectId: string) =>
        [...projectQueryKeys.data(projectId), 'connections'] as const,
    membership: (projectId: string) => [...projectQueryKeys.data(projectId), 'membership'] as const,
    duePublications: (projectId: string) => [...projectQueryKeys.data(projectId), 'due'] as const,
    publications: (projectId: string) =>
        [...projectQueryKeys.data(projectId), 'publications'] as const,
    calendarPublications: (projectId: string) =>
        ['project', projectId, 'calendar-publications'] as const,
    publicationQueues: (projectId: string) => ['project', projectId, 'publication-queues'] as const,
    publicationEditors: (projectId: string) =>
        ['project', projectId, 'publication-editor'] as const,
    projectTagsCatalog: (projectId: string) =>
        [...projectQueryKeys.data(projectId), 'project-tags', 'catalog'] as const,
    publicationApprovals: (projectId: string) =>
        ['project', projectId, 'publication-approval-requests'] as const,
    providerAnalytics: (projectId: string, provider: string) =>
        ['project', projectId, 'provider-analytics', provider] as const,
    publicationEditor: (projectId: string, publicationId: string) =>
        [...projectQueryKeys.publicationEditors(projectId), publicationId] as const,
    publicationEditorInstance: (projectId: string, publicationId: string, instanceId: string) =>
        [...projectQueryKeys.publicationEditor(projectId, publicationId), instanceId] as const,
    notifications: (projectId: string) => ['project', projectId, 'notifications'] as const,
    notificationPreferences: (projectId: string) =>
        ['project', projectId, 'notification-preferences'] as const,
} as const
