export function publisherChannelsReturnPath(projectId: string, channelId: string): string {
    return `/dashboard/projects/${encodeURIComponent(projectId)}/channels?publisher_channel=${encodeURIComponent(channelId)}`
}
