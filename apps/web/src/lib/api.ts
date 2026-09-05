import {
    createHeraldClient,
    type AuditEvent,
    type Channel,
    type ChannelProfileActivation,
    type ChannelProfileAssessment,
    type ChannelProfileState,
    type ChannelProfileVersion,
    type DuePublication,
    type MediaFinalize,
    type MediaReference,
    type MediaReservation,
    type MediaUpload,
    type Post,
    type PublicationEditorState,
    type ProjectAccessToken,
    type PublisherConnection,
    type Project,
    type Publication,
    type PublicationSummary,
} from '@herald/client'

const client = createHeraldClient(window.location.origin)

export interface Session {
    readonly user: {
        readonly id: string
        readonly name: string
        readonly email: string
    }
    readonly session: {
        readonly id: string
    }
}

export type LinkedInConnectionDestination =
    | { readonly type: 'member' }
    | { readonly type: 'organization'; readonly id: string }

export interface RuntimeChannelProfile {
    readonly id: string
    readonly version: number
    readonly profileHash: string
    readonly schemaHash: string
    readonly origin: 'custom'
    readonly contentSchema: unknown
    readonly fieldBindings: unknown
    readonly capabilities: unknown
    readonly execution: unknown
}

export type ChannelCreationProfile = 'manual-message' | 'linkedin' | RuntimeChannelProfile

export type CustomHttpAuthentication =
    | { readonly kind: 'none' }
    | { readonly kind: 'bearer' }
    | { readonly kind: 'header'; readonly headerName: string }

export type ChannelLifecycleBlocker =
    | 'active_work'
    | 'pending_authorization'
    | 'publications'
    | 'publisher'
    | 'must_be_archived'

export class ApiError extends Error {
    readonly status: number
    readonly code: string
    readonly blockers: readonly string[]

    constructor(status: number, code: string, message: string, blockers: readonly string[] = []) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.blockers = blockers
    }
}

interface ErrorBody {
    readonly error?: {
        readonly code?: string
        readonly message?: string
        readonly blockers?: readonly string[]
    }
}

function isErrorBody(value: unknown): value is ErrorBody {
    return typeof value === 'object' && value !== null && 'error' in value
}

function errorFrom(status: number, value: unknown) {
    const body = isErrorBody(value) ? value.error : undefined
    return new ApiError(
        status,
        body?.code ?? 'request_failed',
        body?.message ?? 'The request could not be completed',
        body?.blockers?.filter((blocker): blocker is string => typeof blocker === 'string') ?? []
    )
}

async function requestAuth<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        credentials: 'same-origin',
        ...init,
        headers: {
            ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...init?.headers,
        },
    })
    const body = (await response.json().catch(() => null)) as unknown

    if (!response.ok) throw errorFrom(response.status, body)
    return body as T
}

function jsonBody(value: unknown, method: 'POST' | 'PATCH' = 'POST'): RequestInit {
    return { method, body: JSON.stringify(value) }
}

function unwrap<T>(result: {
    readonly data: unknown
    readonly error: unknown
    readonly status: number
}): T {
    if (result.error !== null) throw errorFrom(result.status, result.error)
    if (result.data === null)
        throw new ApiError(result.status, 'empty_response', 'Empty API response')
    return result.data as T
}

export const api = {
    getSession(): Promise<Session | null> {
        return requestAuth<Session | null>('/api/auth/get-session')
    },

    signIn(email: string, password: string): Promise<Session> {
        return requestAuth<Session>('/api/auth/sign-in/email', jsonBody({ email, password }))
    },

    signUp(name: string, email: string, password: string): Promise<Session> {
        return requestAuth<Session>('/api/auth/sign-up/email', jsonBody({ name, email, password }))
    },

    signOut(): Promise<unknown> {
        return requestAuth('/api/auth/sign-out', jsonBody({}))
    },

    async listProjects(): Promise<{ projects: Project[] }> {
        return unwrap<{ projects: Project[] }>(await client.api.projects.get())
    },

    async createProject(name: string, timeZone?: string): Promise<{ project: Project }> {
        return unwrap<{ project: Project }>(
            await client.api.projects.post(timeZone === undefined ? { name } : { name, timeZone })
        )
    },

    async updateProjectTimeZone(projectId: string, timeZone: string): Promise<Project> {
        return unwrap<Project>(await client.api.projects({ projectId }).patch({ timeZone }))
    },

    async listProjectAccessTokens(
        projectId: string
    ): Promise<{ accessTokens: ProjectAccessToken[] }> {
        return unwrap<{ accessTokens: ProjectAccessToken[] }>(
            await client.api.projects({ projectId })['access-tokens'].get()
        )
    },

    async createProjectAccessToken(
        projectId: string,
        name: string
    ): Promise<{ accessToken: ProjectAccessToken; token: string }> {
        return unwrap<{ accessToken: ProjectAccessToken; token: string }>(
            await client.api.projects({ projectId })['access-tokens'].post({ name })
        )
    },

    async revokeProjectAccessToken(
        projectId: string,
        tokenId: string
    ): Promise<{ accessToken: ProjectAccessToken }> {
        return unwrap<{ accessToken: ProjectAccessToken }>(
            await client.api.projects({ projectId })['access-tokens']({ tokenId }).delete()
        )
    },

    async listChannels(projectId: string): Promise<{ channels: Channel[] }> {
        return unwrap<{ channels: Channel[] }>(
            await client.api.projects({ projectId }).channels.get()
        )
    },

    async listMedia(projectId: string): Promise<{ media: MediaReference[] }> {
        return unwrap<{ media: MediaReference[] }>(
            await client.api.projects({ projectId }).media.get()
        )
    },

    async getMedia(projectId: string, assetId: string): Promise<MediaReference> {
        return unwrap<MediaReference>(
            await client.api.projects({ projectId }).media({ assetId }).get()
        )
    },

    async reserveMediaUpload(
        projectId: string,
        input: {
            originalFilename: string
            defaultAccessibilityText?: string
            expectedSize?: number
            contentType?: string
        }
    ): Promise<MediaReservation> {
        return unwrap<MediaReservation>(
            await client.api.projects({ projectId }).media.uploads.post(input)
        )
    },

    async uploadMedia(projectId: string, intentId: string, file: File): Promise<MediaUpload> {
        return requestAuth<MediaUpload>(
            `/api/projects/${encodeURIComponent(projectId)}/media/uploads/${encodeURIComponent(intentId)}`,
            {
                method: 'PUT',
                body: file,
                headers: {
                    'content-type': file.type || 'application/octet-stream',
                },
            }
        )
    },

    async finalizeMediaUpload(
        projectId: string,
        intentId: string
    ): Promise<MediaFinalize | { status: 'pending'; media: MediaReservation }> {
        return unwrap<MediaFinalize | { status: 'pending'; media: MediaReservation }>(
            await client.api.projects({ projectId }).media.uploads({ intentId }).finalize.post()
        )
    },

    mediaContentUrl(projectId: string, assetId: string): string {
        return `/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(assetId)}/content`
    },

    async getChannelProfileState(
        projectId: string,
        channelId: string
    ): Promise<ChannelProfileState> {
        return unwrap<ChannelProfileState>(
            await client.api.projects({ projectId }).channels({ channelId }).profile.get()
        )
    },

    async saveChannelProfileDraft(
        projectId: string,
        channelId: string,
        profile: Record<string, unknown>,
        expectedRevision?: number
    ): Promise<{ profile: ChannelProfileVersion }> {
        const body = expectedRevision === undefined ? { profile } : { profile, expectedRevision }
        return unwrap<{ profile: ChannelProfileVersion }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                ['profile-drafts'].post(body)
        )
    },

    async previewChannelProfileActivation(
        projectId: string,
        channelId: string,
        profileVersionId: string
    ): Promise<{ assessment: ChannelProfileAssessment }> {
        return unwrap<{ assessment: ChannelProfileAssessment }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                ['profile-drafts']({ profileVersionId })
                .preview.post()
        )
    },

    async activateChannelProfile(
        projectId: string,
        channelId: string,
        profileVersionId: string,
        expectedRevision?: number
    ): Promise<ChannelProfileActivation> {
        return unwrap<ChannelProfileActivation>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                ['profile-drafts']({ profileVersionId })
                .activate.post(expectedRevision === undefined ? {} : { expectedRevision })
        )
    },

    async listPublisherConnections(
        projectId: string
    ): Promise<{ connections: PublisherConnection[] }> {
        return unwrap<{ connections: PublisherConnection[] }>(
            await client.api.projects({ projectId }).publishers.get()
        )
    },

    async startLinkedInPublisherConnection(
        projectId: string,
        channelId: string,
        destination?: LinkedInConnectionDestination
    ): Promise<{ provider: 'linkedin'; scopes: string[]; authorizationUrl: string }> {
        return unwrap<{ provider: 'linkedin'; scopes: string[]; authorizationUrl: string }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.linkedin.connect.post(destination === undefined ? {} : { destination })
        )
    },

    async disconnectPublisher(
        projectId: string,
        channelId: string
    ): Promise<{ disconnected: true }> {
        return unwrap<{ disconnected: true }>(
            await client.api.projects({ projectId }).channels({ channelId }).publisher.delete()
        )
    },

    async createChannel(
        projectId: string,
        name: string,
        profile: ChannelCreationProfile = 'manual-message'
    ): Promise<{ channel: Channel }> {
        return unwrap<{ channel: Channel }>(
            await client.api.projects({ projectId }).channels.post({ name, profile })
        )
    },

    async renameChannel(
        projectId: string,
        channelId: string,
        name: string,
        expectedRevision: number
    ): Promise<{ channel: Channel }> {
        return unwrap<{ channel: Channel }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .patch({ name, expectedRevision })
        )
    },

    async archiveChannel(
        projectId: string,
        channelId: string,
        expectedRevision: number
    ): Promise<{ channel: Channel }> {
        return unwrap<{ channel: Channel }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .archive.post({ expectedRevision })
        )
    },

    async restoreChannel(
        projectId: string,
        channelId: string,
        expectedRevision: number
    ): Promise<{ channel: Channel }> {
        return unwrap<{ channel: Channel }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .restore.post({ expectedRevision })
        )
    },

    async deleteChannel(
        projectId: string,
        channelId: string,
        expectedRevision: number
    ): Promise<{ deleted: true }> {
        return unwrap<{ deleted: true }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .delete({ expectedRevision })
        )
    },

    async connectCustomHttpPublisher(
        projectId: string,
        channelId: string,
        input: {
            endpointUrl: string
            authentication: CustomHttpAuthentication
            externalAccountName?: string | null
            secret: string
        }
    ): Promise<{ connection: PublisherConnection }> {
        return unwrap<{ connection: PublisherConnection }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher['custom-http'].connect.post(input)
        )
    },

    async createPost(
        projectId: string,
        input: {
            title?: string
            sourceContent: PublicationEditorState['post']['sourceContent']
            publications: Array<{
                channelId: string
                targetContent?: Record<string, unknown>
                deliveryMode: 'manual' | 'automatic'
                scheduledAt?: number | null
            }>
        }
    ): Promise<{ post: Post; publications: Publication[] }> {
        return unwrap<{ post: Post; publications: Publication[] }>(
            await client.api.projects({ projectId }).posts.post(input)
        )
    },

    async listDuePublications(projectId: string): Promise<{ publications: DuePublication[] }> {
        return unwrap<{ publications: DuePublication[] }>(
            await client.api.projects({ projectId }).publications.due.get()
        )
    },

    async listPublications(projectId: string): Promise<{ publications: PublicationSummary[] }> {
        return unwrap<{ publications: PublicationSummary[] }>(
            await client.api.projects({ projectId }).publications.get()
        )
    },

    async getPublicationEditor(
        projectId: string,
        publicationId: string
    ): Promise<{ editor: PublicationEditorState }> {
        return unwrap<{ editor: PublicationEditorState }>(
            await client.api.projects({ projectId }).publications({ publicationId }).editor.get()
        )
    },

    async savePublicationDraft(
        projectId: string,
        publicationId: string,
        input: {
            expectedRevision: number
            sourceContent?: PublicationEditorState['post']['sourceContent']
            targetContent?: Record<string, unknown>
        }
    ): Promise<{ editor: PublicationEditorState }> {
        return unwrap<{ editor: PublicationEditorState }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .draft.patch(input)
        )
    },

    async promotePublicationDraft(
        projectId: string,
        publicationId: string,
        expectedRevision: number,
        scheduledAt?: number | null
    ): Promise<{ editor: PublicationEditorState }> {
        return unwrap<{ editor: PublicationEditorState }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .draft.promote.post(
                    scheduledAt === undefined
                        ? { expectedRevision }
                        : { expectedRevision, scheduledAt }
                )
        )
    },

    async rebasePublicationDraft(
        projectId: string,
        publicationId: string,
        expectedRevision: number
    ): Promise<{ editor: PublicationEditorState }> {
        return unwrap<{ editor: PublicationEditorState }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .draft.rebase.post({ expectedRevision })
        )
    },

    async publishManualPublication(
        projectId: string,
        publicationId: string,
        externalUrl?: string
    ): Promise<{ publication: Publication }> {
        return unwrap<{ publication: Publication }>(
            await client.api
                .projects({ projectId })
                .publications({ publicationId })
                .publish.post(externalUrl === undefined ? {} : { externalUrl })
        )
    },

    async listAuditEvents(projectId: string): Promise<{ events: AuditEvent[] }> {
        return unwrap<{ events: AuditEvent[] }>(
            await client.api.projects({ projectId })['audit-events'].get()
        )
    },
}

export type {
    AuditEvent,
    Channel,
    ChannelProfileActivation,
    ChannelProfileAssessment,
    ChannelProfileState,
    ChannelProfileVersion,
    DuePublication,
    MediaFinalize,
    MediaReference,
    MediaReservation,
    Post,
    PublicationEditorState,
    ProjectAccessToken,
    PublisherConnection,
    Project,
    Publication,
    PublicationSummary,
} from '@herald/client'

export function formatApiError(error: unknown): string {
    if (!(error instanceof ApiError)) return 'The action could not be completed'
    if (error.blockers.length === 0) return error.message

    const labels = error.blockers.map(channelLifecycleBlockerLabel).join(', ')
    return `${error.message}: ${labels}.`
}

function channelLifecycleBlockerLabel(blocker: string): string {
    if (blocker === 'active_work') return 'active publication work'
    if (blocker === 'pending_authorization') return 'a pending publisher authorization'
    if (blocker === 'publications') return 'publication history'
    if (blocker === 'publisher') return 'a connected publisher'
    if (blocker === 'must_be_archived') return 'the channel must be archived first'
    return blocker
}
