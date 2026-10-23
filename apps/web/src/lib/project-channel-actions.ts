import { useQueryClient } from '@tanstack/react-query'

import {
    api,
    ApiError,
    formatApiError,
    type ChannelCreationOutcome,
    type ChannelCreationProfile,
    type LinkedInConnectionDestination,
    type WebApiRequests,
} from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useProjectAction } from '@/lib/project-action'
import { projectResourceQueries, refreshChannelResources } from '@/lib/project-resources'

export function useProjectChannelActions(onCreated?: (channelId: string) => void) {
    const { project, error: shellError } = useProjectDashboard()
    const queryClient = useQueryClient()
    const { error, pending, setError, setPending, runAction } = useProjectAction()
    const onRefreshProject = () => refreshChannelResources(queryClient, project.id)

    async function onCreateChannel(
        name: string,
        profile: ChannelCreationProfile
    ): Promise<ChannelCreationOutcome> {
        if (name.trim() === '') return { created: false, profileIssues: [], profileIssueCount: 0 }
        setError(null)
        setPending(true)
        try {
            const { channel } = await api.createChannel(project.id, name.trim(), profile)
            const response = await api.listChannels(project.id)
            onCreated?.(channel.id)
            queryClient.setQueryData(projectResourceQueries.channels(project.id).queryKey, response)
            return { created: true, profileIssues: [], profileIssueCount: 0 }
        } catch (caughtError) {
            if (
                caughtError instanceof ApiError &&
                caughtError.status === 400 &&
                caughtError.code === 'invalid_content' &&
                caughtError.profileIssues.length > 0
            ) {
                return {
                    created: false,
                    profileIssues: caughtError.profileIssues,
                    profileIssueCount: caughtError.profileIssueCount,
                }
            }
            setError(formatApiError(caughtError))
            return { created: false, profileIssues: [], profileIssueCount: 0 }
        } finally {
            setPending(false)
        }
    }

    async function updateChannel(action: () => Promise<unknown>) {
        return runAction(async () => {
            await action()
            await onRefreshProject()
        })
    }
    const onRenameChannel = (channelId: string, name: string, revision: number) =>
        updateChannel(() => api.renameChannel(project.id, channelId, name.trim(), revision))
    const onArchiveChannel = (channelId: string, revision: number) =>
        updateChannel(() => api.archiveChannel(project.id, channelId, revision))
    const onRestoreChannel = (channelId: string, revision: number) =>
        updateChannel(() => api.restoreChannel(project.id, channelId, revision))
    const onDeleteChannel = (channelId: string, revision: number) =>
        updateChannel(() => api.deleteChannel(project.id, channelId, revision))
    async function onDisconnectPublisher(channelId: string) {
        await updateChannel(() => api.disconnectPublisher(project.id, channelId))
    }
    // Connection forms own their errors; retain rejection so they keep entered credentials.
    async function connect(action: () => Promise<unknown>) {
        setError(null)
        await action()
        await onRefreshProject()
        return true
    }
    const onConnectDiscordPublisher = (
        channelId: string,
        input: WebApiRequests['connectDiscordPublisher']
    ) => connect(() => api.connectDiscordPublisher(project.id, channelId, input))
    const onConnectTelegramPublisher = (
        channelId: string,
        input: WebApiRequests['connectTelegramPublisher']
    ) => connect(() => api.connectTelegramPublisher(project.id, channelId, input))
    const onConnectDevtoPublisher = (channelId: string, apiKey: string) =>
        connect(() => api.connectDevtoPublisher(project.id, channelId, apiKey))
    const onConnectCustomHttpPublisher = (
        channelId: string,
        input: WebApiRequests['connectCustomHttpPublisher']
    ) => connect(() => api.connectCustomHttpPublisher(project.id, channelId, input))
    async function onStartLinkedInConnection(
        channelId: string,
        destination?: LinkedInConnectionDestination,
        providerApplicationId?: string
    ) {
        setError(null)
        const { authorizationUrl } = await api.startLinkedInPublisherConnection(
            project.id,
            channelId,
            destination,
            providerApplicationId
        )
        window.location.assign(authorizationUrl)
    }
    async function onStartBlueskyConnection(
        channelId: string,
        handle: string,
        providerApplicationId?: string
    ) {
        setError(null)
        const { authorizationUrl } = await api.startBlueskyPublisherConnection(
            project.id,
            channelId,
            handle,
            providerApplicationId
        )
        window.location.assign(authorizationUrl)
    }
    async function onStartMastodonConnection(channelId: string, instanceUrl: string) {
        setError(null)
        const { authorizationUrl } = await api.startMastodonPublisherConnection(
            project.id,
            channelId,
            instanceUrl
        )
        window.location.assign(authorizationUrl)
    }
    async function onStartXConnection(channelId: string, providerApplicationId?: string) {
        setError(null)
        const { authorizationUrl } = await api.startXPublisherConnection(
            project.id,
            channelId,
            providerApplicationId
        )
        window.location.assign(authorizationUrl)
    }
    return {
        error: error ?? shellError,
        pending,
        onCreateChannel,
        onRenameChannel,
        onArchiveChannel,
        onRestoreChannel,
        onDeleteChannel,
        onDisconnectPublisher,
        onRefreshProject,
        onConnectDiscordPublisher,
        onConnectTelegramPublisher,
        onConnectDevtoPublisher,
        onConnectCustomHttpPublisher,
        onStartLinkedInConnection,
        onStartBlueskyConnection,
        onStartMastodonConnection,
        onStartXConnection,
    }
}
