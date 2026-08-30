import {
    createHeraldClient,
    type AuditEvent,
    type Channel,
    type DuePublication,
    type Post,
    type PublisherConnection,
    type Project,
    type Publication,
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

export class ApiError extends Error {
    readonly status: number
    readonly code: string

    constructor(status: number, code: string, message: string) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
    }
}

interface ErrorBody {
    readonly error?: {
        readonly code?: string
        readonly message?: string
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
        body?.message ?? 'The request could not be completed'
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

function jsonBody(value: unknown): RequestInit {
    return { method: 'POST', body: JSON.stringify(value) }
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

    async createProject(name: string): Promise<{ project: Project }> {
        return unwrap<{ project: Project }>(await client.api.projects.post({ name }))
    },

    async listChannels(projectId: string): Promise<{ channels: Channel[] }> {
        return unwrap<{ channels: Channel[] }>(
            await client.api.projects({ projectId }).channels.get()
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
        channelId: string
    ): Promise<{ provider: 'linkedin'; scopes: string[]; authorizationUrl: string }> {
        return unwrap<{ provider: 'linkedin'; scopes: string[]; authorizationUrl: string }>(
            await client.api
                .projects({ projectId })
                .channels({ channelId })
                .publisher.linkedin.connect.post()
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

    async createChannel(projectId: string, name: string): Promise<{ channel: Channel }> {
        return unwrap<{ channel: Channel }>(
            await client.api.projects({ projectId }).channels.post({ name })
        )
    },

    async createPost(
        projectId: string,
        input: {
            title?: string
            content: string
            publications: Array<{
                channelId: string
                content?: string
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
    DuePublication,
    Post,
    PublisherConnection,
    Project,
    Publication,
} from '@herald/client'
