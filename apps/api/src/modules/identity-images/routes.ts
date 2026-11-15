import { DomainInvariantError } from '@postdot/core'
import {
    IdentityImageValidationError,
    identityImageMaxBytes,
    type AccessStore,
    type IdentityImageStore,
} from '@postdot/db'
import type { OpenAPIV3 } from 'openapi-types'
import { Type } from 'typebox'

import { canAccessProjectRole, forbiddenProjectMutation } from '../projects/authorization'
import {
    channelParams,
    channelSchema,
    errorResponse,
    projectParams,
    projectSchema,
} from '../projects/models'
import type { AuthenticatedElysia, ManualStore } from '../projects/types'
import { IdentityImageRemoteError, type IdentityImageResolver } from './resolver'

const identityImageParams = Type.Object({
    sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
})

const workspaceParams = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
})

const workspaceSchema = Type.Object({
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    slug: Type.String({ minLength: 1 }),
    isDefault: Type.Boolean(),
    websiteUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    imageUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    imageSource: Type.Union([
        Type.Literal('upload'),
        Type.Literal('url'),
        Type.Literal('favicon'),
        Type.Null(),
    ]),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
})

const setWebsiteBody = Type.Object({
    websiteUrl: Type.Union([Type.String({ maxLength: 2_048 }), Type.Null()]),
})

const setChannelWebsiteBody = Type.Object({
    websiteUrl: Type.Union([Type.String({ maxLength: 2_048 }), Type.Null()]),
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
})

const importImageUrlBody = Type.Object({
    url: Type.String({ minLength: 1, maxLength: 2_048 }),
})

const importChannelImageUrlBody = Type.Object({
    url: Type.String({ minLength: 1, maxLength: 2_048 }),
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
})

const channelRevisionQuery = Type.Object({
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
})

const projectMutationResponse = Type.Object({
    project: projectSchema,
    warning: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

const workspaceMutationResponse = Type.Object({
    workspace: workspaceSchema,
    warning: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

const channelMutationResponse = Type.Object({
    channel: channelSchema,
    warning: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

const MULTIPART_ENVELOPE_OVERHEAD_BYTES = 128 * 1024

const uploadRequestBodyDetail: OpenAPIV3.RequestBodyObject = {
    required: true,
    content: {
        'multipart/form-data': {
            schema: {
                type: 'object',
                required: ['file'],
                properties: {
                    file: {
                        type: 'string',
                        format: 'binary',
                    },
                },
            },
        },
        'application/octet-stream': {
            schema: {
                type: 'string',
                format: 'binary',
            },
        },
    },
}

type UploadExtractionResult =
    | {
          readonly ok: true
          readonly bytes: Uint8Array
          readonly expectedRevision?: number
      }
    | {
          readonly ok: false
          readonly status: 400 | 413
          readonly code: 'identity_image_empty' | 'identity_image_size' | 'invalid_input'
          readonly message: string
      }

async function readBoundedRequestBytes(
    request: Request,
    maxBytes: number
): Promise<
    | { readonly ok: true; readonly bytes: Uint8Array }
    | { readonly ok: false; readonly reason: 'empty' | 'too_large' }
> {
    const contentLengthHeader = request.headers.get('content-length')
    if (contentLengthHeader !== null) {
        const declared = Number(contentLengthHeader)
        if (Number.isSafeInteger(declared) && declared > maxBytes) {
            return { ok: false, reason: 'too_large' }
        }
    }
    const reader = request.body?.getReader()
    if (!reader) {
        return { ok: false, reason: 'empty' }
    }
    const chunks: Uint8Array[] = []
    let total = 0
    try {
        while (true) {
            const next = await reader.read()
            if (next.done) break
            total += next.value.byteLength
            if (total > maxBytes) {
                await reader.cancel()
                return { ok: false, reason: 'too_large' }
            }
            chunks.push(next.value)
        }
    } finally {
        reader.releaseLock()
    }
    if (total === 0) {
        return { ok: false, reason: 'empty' }
    }
    const combined = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.byteLength
    }
    return { ok: true, bytes: combined }
}

async function extractUploadedImageBytes(request: Request): Promise<UploadExtractionResult> {
    const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
    const isMultipart = contentType.startsWith('multipart/form-data')
    const rawLimit = isMultipart
        ? identityImageMaxBytes + MULTIPART_ENVELOPE_OVERHEAD_BYTES
        : identityImageMaxBytes

    const readResult = await readBoundedRequestBytes(request, rawLimit)
    if (!readResult.ok) {
        return readResult.reason === 'too_large'
            ? {
                  ok: false,
                  status: 413,
                  code: 'identity_image_size',
                  message: 'Image exceeds the 2 MB limit',
              }
            : {
                  ok: false,
                  status: 400,
                  code: 'identity_image_empty',
                  message: 'An image file is required',
              }
    }

    if (!isMultipart) {
        return { ok: true, bytes: readResult.bytes }
    }

    let formData: Awaited<ReturnType<Request['formData']>>
    try {
        const synthetic = new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: readResult.bytes.slice().buffer,
        })
        formData = await synthetic.formData()
    } catch {
        return {
            ok: false,
            status: 400,
            code: 'invalid_input',
            message: 'Malformed multipart form upload',
        }
    }

    let fileEntry: Blob | null = null
    for (const key of ['file', 'image']) {
        const candidate: unknown = formData.get(key)
        if (candidate instanceof Blob) {
            fileEntry = candidate
            break
        }
    }
    if (fileEntry === null) {
        formData.forEach(value => {
            const candidate: unknown = value
            if (fileEntry === null && candidate instanceof Blob) {
                fileEntry = candidate
            }
        })
    }
    if (fileEntry === null || fileEntry.size === 0) {
        return {
            ok: false,
            status: 400,
            code: 'identity_image_empty',
            message: 'An image file is required',
        }
    }
    if (fileEntry.size > identityImageMaxBytes) {
        return {
            ok: false,
            status: 413,
            code: 'identity_image_size',
            message: 'Image exceeds the 2 MB limit',
        }
    }

    let expectedRevision: number | undefined
    const rawExpectedRevision = formData.get('expectedRevision')
    if (typeof rawExpectedRevision === 'string' && rawExpectedRevision.trim().length > 0) {
        const parsed = Number(rawExpectedRevision.trim())
        if (!Number.isSafeInteger(parsed) || parsed < 1) {
            return {
                ok: false,
                status: 400,
                code: 'invalid_input',
                message: 'expectedRevision must be a positive integer',
            }
        }
        expectedRevision = parsed
    }

    return {
        ok: true,
        bytes: new Uint8Array(await fileEntry.arrayBuffer()),
        expectedRevision,
    }
}

export interface IdentityImageRoutesOptions {
    readonly identityImages: IdentityImageStore
    readonly resolver: IdentityImageResolver
    readonly manualStore: ManualStore
    readonly access: AccessStore
}

export function registerIdentityImageRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    options: IdentityImageRoutesOptions
) {
    const { identityImages, resolver, manualStore, access } = options

    async function loadProjectResponse(projectId: string, userId: string) {
        const workspaceId = await access.getProjectWorkspaceId(projectId)
        if (workspaceId !== null) {
            const projects = await manualStore.listProjectsForWorkspace(workspaceId)
            const found = projects.find(project => project.id === projectId)
            if (found) return found
        }
        const actorProjects = await manualStore.listProjects(userId)
        return actorProjects.find(project => project.id === projectId) ?? null
    }

    async function loadWorkspaceResponse(workspaceId: string) {
        const workspace = await access.getWorkspace(workspaceId)
        if (workspace === null) return null
        const { organizationId: _organizationId, ...publicWorkspace } = workspace
        return publicWorkspace
    }

    async function loadChannelResponse(projectId: string, channelId: string, userId: string) {
        const channels = await manualStore.listChannels(projectId, userId)
        const found = channels?.find(channel => channel.id === channelId)
        if (!found) return null
        const { shared: _shared, execution: _execution, ...channel } = found
        return channel
    }

    function mapIdentityError(error: unknown): {
        readonly status: 400 | 409 | 413 | 415 | 422 | 502
        readonly body: { readonly error: { readonly code: string; readonly message: string } }
    } | null {
        if (error instanceof IdentityImageRemoteError) {
            return {
                status: error.status,
                body: { error: { code: error.code, message: error.message } },
            }
        }
        if (error instanceof IdentityImageValidationError) {
            const status =
                error.code === 'identity_image_size'
                    ? 413
                    : error.code === 'identity_image_format'
                      ? 415
                      : 400
            return {
                status,
                body: { error: { code: error.code, message: error.message } },
            }
        }
        if (error instanceof DomainInvariantError) {
            const status = error.code === 'write_conflict' ? 409 : 400
            return {
                status,
                body: { error: { code: error.code, message: error.message } },
            }
        }
        return null
    }

    return app
        .get(
            '/api/identity-images/:sha256',
            {
                auth: true,
                params: identityImageParams,
                detail: {
                    operationId: 'getIdentityImage',
                    summary: 'Read a processed identity image by content hash',
                    tags: ['Media'],
                    responses: {
                        200: {
                            description: 'Processed square WebP identity image',
                            content: {
                                'image/webp': {
                                    schema: {
                                        type: 'string',
                                        format: 'binary',
                                    } as OpenAPIV3.SchemaObject,
                                },
                            },
                        },
                        401: {
                            description: 'Authentication required',
                            content: { 'application/json': { schema: errorResponse } },
                        },
                        403: {
                            description: 'The API key does not allow this action',
                            content: { 'application/json': { schema: errorResponse } },
                        },
                        404: {
                            description: 'Identity image not found',
                            content: { 'application/json': { schema: errorResponse } },
                        },
                    },
                },
            },
            async ({ params, status }) => {
                const stored = await identityImages.open(params.sha256)
                if (stored === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Identity image not found' },
                    })
                }
                return new Response(new Uint8Array(stored.bytes), {
                    headers: {
                        'content-type': stored.contentType,
                        'cache-control': 'public, max-age=31536000, immutable',
                        'x-content-type-options': 'nosniff',
                        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
                    },
                })
            }
        )
        .put(
            '/api/projects/:projectId/website',
            {
                auth: true,
                params: projectParams,
                body: setWebsiteBody,
                response: {
                    200: projectMutationResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                },
                detail: {
                    operationId: 'setProjectWebsite',
                    summary: 'Set or clear a project website URL',
                    tags: ['Projects'],
                },
            },
            async ({ authMethod, body, params, status, user }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const current = await identityImages.getProjectIdentity(params.projectId)
                if (current === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                try {
                    const trimmed = body.websiteUrl?.trim() ?? ''
                    if (trimmed.length === 0) {
                        await identityImages.setProjectWebsite({
                            projectId: params.projectId,
                            websiteUrl: null,
                        })
                        const project = await loadProjectResponse(params.projectId, user.id)
                        if (project === null) {
                            return status(404, {
                                error: { code: 'not_found', message: 'Project not found' },
                            })
                        }
                        return { project, warning: null }
                    }

                    const resolved = await resolver.tryResolveWebsiteFavicon(trimmed)
                    const hasExplicitImage =
                        current.imageSource === 'upload' || current.imageSource === 'url'
                    await identityImages.setProjectWebsite({
                        projectId: params.projectId,
                        websiteUrl: resolved.normalizedWebsiteUrl,
                        faviconBytes: hasExplicitImage
                            ? undefined
                            : (resolved.favicon?.bytes ?? null),
                    })
                    const project = await loadProjectResponse(params.projectId, user.id)
                    if (project === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Project not found' },
                        })
                    }
                    return {
                        project,
                        warning: hasExplicitImage ? null : resolved.warning,
                    }
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
        .post(
            '/api/projects/:projectId/image',
            {
                auth: true,
                parse: 'none',
                params: projectParams,
                response: {
                    200: projectMutationResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                },
                detail: {
                    operationId: 'uploadProjectImage',
                    summary: 'Upload a project identity image',
                    tags: ['Projects'],
                    requestBody: uploadRequestBodyDetail,
                },
            },
            async ({ authMethod, params, request, status, user }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const extracted = await extractUploadedImageBytes(request)
                if (!extracted.ok) {
                    return status(extracted.status, {
                        error: { code: extracted.code, message: extracted.message },
                    })
                }
                try {
                    const saved = await identityImages.setProjectImage({
                        projectId: params.projectId,
                        bytes: extracted.bytes,
                        source: 'upload',
                    })
                    if (saved === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Project not found' },
                        })
                    }
                    const project = await loadProjectResponse(params.projectId, user.id)
                    if (project === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Project not found' },
                        })
                    }
                    return { project }
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
        .post(
            '/api/projects/:projectId/image/url',
            {
                auth: true,
                params: projectParams,
                body: importImageUrlBody,
                response: {
                    200: projectMutationResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                },
                detail: {
                    operationId: 'importProjectImageUrl',
                    summary: 'Set a project identity image from a URL',
                    tags: ['Projects'],
                },
            },
            async ({ authMethod, body, params, status, user }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                if ((await identityImages.getProjectIdentity(params.projectId)) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                try {
                    const downloaded = await resolver.fetchImageFromUrl(body.url)
                    await identityImages.setProjectImage({
                        projectId: params.projectId,
                        bytes: downloaded.bytes,
                        source: 'url',
                    })
                    const project = await loadProjectResponse(params.projectId, user.id)
                    if (project === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Project not found' },
                        })
                    }
                    return { project }
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
        .post(
            '/api/projects/:projectId/image/favicon',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: projectMutationResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                },
                detail: {
                    operationId: 'useProjectWebsiteIcon',
                    summary: 'Use the project website favicon as its identity image',
                    tags: ['Projects'],
                },
            },
            async ({ authMethod, params, status, user }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const current = await identityImages.getProjectIdentity(params.projectId)
                if (current === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                if (!current.websiteUrl) {
                    return status(400, {
                        error: {
                            code: 'identity_website_invalid',
                            message: 'Set a website URL first before using its icon',
                        },
                    })
                }
                try {
                    const favicon = await resolver.resolveWebsiteFavicon(current.websiteUrl)
                    await identityImages.setProjectImage({
                        projectId: params.projectId,
                        bytes: favicon.bytes,
                        source: 'favicon',
                    })
                    const project = await loadProjectResponse(params.projectId, user.id)
                    if (project === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Project not found' },
                        })
                    }
                    return { project }
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
        .delete(
            '/api/projects/:projectId/image',
            {
                auth: true,
                params: projectParams,
                response: {
                    200: projectMutationResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'removeProjectImage',
                    summary: 'Remove a project identity image',
                    tags: ['Projects'],
                },
            },
            async ({ authMethod, params, status, user }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const removed = await identityImages.removeProjectImage(params.projectId)
                if (!removed) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                const project = await loadProjectResponse(params.projectId, user.id)
                if (project === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return { project }
            }
        )
        .put(
            '/api/workspaces/:workspaceId/website',
            {
                auth: true,
                params: workspaceParams,
                body: setWebsiteBody,
                response: {
                    200: workspaceMutationResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                },
                detail: {
                    operationId: 'setWorkspaceWebsite',
                    summary: 'Set or clear a workspace website URL',
                    tags: ['Access'],
                },
            },
            async ({ body, params, status, user }) => {
                const current = await identityImages.getWorkspaceIdentity(params.workspaceId)
                if (current === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!(await access.canManageWorkspace(params.workspaceId, user.id))) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'A workspace owner or administrator role is required',
                        },
                    })
                }
                try {
                    const trimmed = body.websiteUrl?.trim() ?? ''
                    if (trimmed.length === 0) {
                        await identityImages.setWorkspaceWebsite({
                            workspaceId: params.workspaceId,
                            websiteUrl: null,
                        })
                        const workspace = await loadWorkspaceResponse(params.workspaceId)
                        if (workspace === null) {
                            return status(404, {
                                error: { code: 'not_found', message: 'Workspace not found' },
                            })
                        }
                        return { workspace, warning: null }
                    }

                    const resolved = await resolver.tryResolveWebsiteFavicon(trimmed)
                    const hasExplicitImage =
                        current.imageSource === 'upload' || current.imageSource === 'url'
                    await identityImages.setWorkspaceWebsite({
                        workspaceId: params.workspaceId,
                        websiteUrl: resolved.normalizedWebsiteUrl,
                        faviconBytes: hasExplicitImage
                            ? undefined
                            : (resolved.favicon?.bytes ?? null),
                    })
                    const workspace = await loadWorkspaceResponse(params.workspaceId)
                    if (workspace === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Workspace not found' },
                        })
                    }
                    return {
                        workspace,
                        warning: hasExplicitImage ? null : resolved.warning,
                    }
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
        .post(
            '/api/workspaces/:workspaceId/image',
            {
                auth: true,
                parse: 'none',
                params: workspaceParams,
                response: {
                    200: workspaceMutationResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                },
                detail: {
                    operationId: 'uploadWorkspaceImage',
                    summary: 'Upload a workspace identity image',
                    tags: ['Access'],
                    requestBody: uploadRequestBodyDetail,
                },
            },
            async ({ params, request, status, user }) => {
                if ((await identityImages.getWorkspaceIdentity(params.workspaceId)) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!(await access.canManageWorkspace(params.workspaceId, user.id))) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'A workspace owner or administrator role is required',
                        },
                    })
                }
                const extracted = await extractUploadedImageBytes(request)
                if (!extracted.ok) {
                    return status(extracted.status, {
                        error: { code: extracted.code, message: extracted.message },
                    })
                }
                try {
                    const saved = await identityImages.setWorkspaceImage({
                        workspaceId: params.workspaceId,
                        bytes: extracted.bytes,
                        source: 'upload',
                    })
                    if (saved === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Workspace not found' },
                        })
                    }
                    const workspace = await loadWorkspaceResponse(params.workspaceId)
                    if (workspace === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Workspace not found' },
                        })
                    }
                    return { workspace }
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
        .post(
            '/api/workspaces/:workspaceId/image/url',
            {
                auth: true,
                params: workspaceParams,
                body: importImageUrlBody,
                response: {
                    200: workspaceMutationResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                },
                detail: {
                    operationId: 'importWorkspaceImageUrl',
                    summary: 'Set a workspace identity image from a URL',
                    tags: ['Access'],
                },
            },
            async ({ body, params, status, user }) => {
                if ((await identityImages.getWorkspaceIdentity(params.workspaceId)) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!(await access.canManageWorkspace(params.workspaceId, user.id))) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'A workspace owner or administrator role is required',
                        },
                    })
                }
                try {
                    const downloaded = await resolver.fetchImageFromUrl(body.url)
                    await identityImages.setWorkspaceImage({
                        workspaceId: params.workspaceId,
                        bytes: downloaded.bytes,
                        source: 'url',
                    })
                    const workspace = await loadWorkspaceResponse(params.workspaceId)
                    if (workspace === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Workspace not found' },
                        })
                    }
                    return { workspace }
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
        .post(
            '/api/workspaces/:workspaceId/image/favicon',
            {
                auth: true,
                params: workspaceParams,
                response: {
                    200: workspaceMutationResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                },
                detail: {
                    operationId: 'useWorkspaceWebsiteIcon',
                    summary: 'Use the workspace website favicon as its identity image',
                    tags: ['Access'],
                },
            },
            async ({ params, status, user }) => {
                const current = await identityImages.getWorkspaceIdentity(params.workspaceId)
                if (current === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!(await access.canManageWorkspace(params.workspaceId, user.id))) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'A workspace owner or administrator role is required',
                        },
                    })
                }
                if (!current.websiteUrl) {
                    return status(400, {
                        error: {
                            code: 'identity_website_invalid',
                            message: 'Set a website URL first before using its icon',
                        },
                    })
                }
                try {
                    const favicon = await resolver.resolveWebsiteFavicon(current.websiteUrl)
                    await identityImages.setWorkspaceImage({
                        workspaceId: params.workspaceId,
                        bytes: favicon.bytes,
                        source: 'favicon',
                    })
                    const workspace = await loadWorkspaceResponse(params.workspaceId)
                    if (workspace === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Workspace not found' },
                        })
                    }
                    return { workspace }
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
        .delete(
            '/api/workspaces/:workspaceId/image',
            {
                auth: true,
                params: workspaceParams,
                response: {
                    200: workspaceMutationResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'removeWorkspaceImage',
                    summary: 'Remove a workspace identity image',
                    tags: ['Access'],
                },
            },
            async ({ params, status, user }) => {
                if ((await identityImages.getWorkspaceIdentity(params.workspaceId)) === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                if (!(await access.canManageWorkspace(params.workspaceId, user.id))) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'A workspace owner or administrator role is required',
                        },
                    })
                }
                await identityImages.removeWorkspaceImage(params.workspaceId)
                const workspace = await loadWorkspaceResponse(params.workspaceId)
                if (workspace === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Workspace not found' },
                    })
                }
                return { workspace }
            }
        )
        .put(
            '/api/projects/:projectId/channels/:channelId/website',
            {
                auth: true,
                params: channelParams,
                body: setChannelWebsiteBody,
                response: {
                    200: channelMutationResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                },
                detail: {
                    operationId: 'setProjectChannelWebsite',
                    summary: 'Set or clear a channel website URL',
                    tags: ['Channels'],
                },
            },
            async ({ authMethod, body, params, status, user }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const existingChannel = await loadChannelResponse(
                    params.projectId,
                    params.channelId,
                    user.id
                )
                const current = await identityImages.getChannelIdentity(params.channelId)
                if (existingChannel === null || current === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                try {
                    const trimmed = body.websiteUrl?.trim() ?? ''
                    if (trimmed.length === 0) {
                        await identityImages.setChannelWebsite({
                            channelId: params.channelId,
                            projectId: params.projectId,
                            expectedRevision: body.expectedRevision,
                            websiteUrl: null,
                        })
                        const channel = await loadChannelResponse(
                            params.projectId,
                            params.channelId,
                            user.id
                        )
                        if (channel === null) {
                            return status(404, {
                                error: { code: 'not_found', message: 'Channel not found' },
                            })
                        }
                        return { channel, warning: null }
                    }

                    const resolved = await resolver.tryResolveWebsiteFavicon(trimmed)
                    const hasExplicitImage =
                        current.imageSource === 'upload' || current.imageSource === 'url'
                    await identityImages.setChannelWebsite({
                        channelId: params.channelId,
                        projectId: params.projectId,
                        expectedRevision: body.expectedRevision,
                        websiteUrl: resolved.normalizedWebsiteUrl,
                        faviconBytes: hasExplicitImage
                            ? undefined
                            : (resolved.favicon?.bytes ?? null),
                    })
                    const channel = await loadChannelResponse(
                        params.projectId,
                        params.channelId,
                        user.id
                    )
                    if (channel === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Channel not found' },
                        })
                    }
                    return {
                        channel,
                        warning: hasExplicitImage ? null : resolved.warning,
                    }
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/image',
            {
                auth: true,
                parse: 'none',
                params: channelParams,
                query: channelRevisionQuery,
                response: {
                    200: channelMutationResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                },
                detail: {
                    operationId: 'uploadProjectChannelImage',
                    summary: 'Upload a channel identity image',
                    tags: ['Channels'],
                    requestBody: uploadRequestBodyDetail,
                },
            },
            async ({ authMethod, params, query, request, status, user }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const existingChannel = await loadChannelResponse(
                    params.projectId,
                    params.channelId,
                    user.id
                )
                if (existingChannel === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                const extracted = await extractUploadedImageBytes(request)
                if (!extracted.ok) {
                    return status(extracted.status, {
                        error: { code: extracted.code, message: extracted.message },
                    })
                }
                try {
                    const saved = await identityImages.setChannelImage({
                        channelId: params.channelId,
                        projectId: params.projectId,
                        expectedRevision: query.expectedRevision ?? extracted.expectedRevision,
                        bytes: extracted.bytes,
                        source: 'upload',
                    })
                    if (saved === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Channel not found' },
                        })
                    }
                    const channel = await loadChannelResponse(
                        params.projectId,
                        params.channelId,
                        user.id
                    )
                    if (channel === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Channel not found' },
                        })
                    }
                    return { channel }
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/image/url',
            {
                auth: true,
                params: channelParams,
                body: importChannelImageUrlBody,
                response: {
                    200: channelMutationResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                },
                detail: {
                    operationId: 'importProjectChannelImageUrl',
                    summary: 'Set a channel identity image from a URL',
                    tags: ['Channels'],
                },
            },
            async ({ authMethod, body, params, status, user }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const existingChannel = await loadChannelResponse(
                    params.projectId,
                    params.channelId,
                    user.id
                )
                if (existingChannel === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                try {
                    const downloaded = await resolver.fetchImageFromUrl(body.url)
                    await identityImages.setChannelImage({
                        channelId: params.channelId,
                        projectId: params.projectId,
                        expectedRevision: body.expectedRevision,
                        bytes: downloaded.bytes,
                        source: 'url',
                    })
                    const channel = await loadChannelResponse(
                        params.projectId,
                        params.channelId,
                        user.id
                    )
                    if (channel === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Channel not found' },
                        })
                    }
                    return { channel }
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
        .post(
            '/api/projects/:projectId/channels/:channelId/image/favicon',
            {
                auth: true,
                params: channelParams,
                query: channelRevisionQuery,
                response: {
                    200: channelMutationResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                },
                detail: {
                    operationId: 'useProjectChannelWebsiteIcon',
                    summary: 'Use the channel website favicon as its identity image',
                    tags: ['Channels'],
                },
            },
            async ({ authMethod, params, query, status, user }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const existingChannel = await loadChannelResponse(
                    params.projectId,
                    params.channelId,
                    user.id
                )
                const current = await identityImages.getChannelIdentity(params.channelId)
                if (existingChannel === null || current === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                if (!current.websiteUrl) {
                    return status(400, {
                        error: {
                            code: 'identity_website_invalid',
                            message: 'Set a website URL first before using its icon',
                        },
                    })
                }
                try {
                    const favicon = await resolver.resolveWebsiteFavicon(current.websiteUrl)
                    await identityImages.setChannelImage({
                        channelId: params.channelId,
                        projectId: params.projectId,
                        expectedRevision: query.expectedRevision,
                        bytes: favicon.bytes,
                        source: 'favicon',
                    })
                    const channel = await loadChannelResponse(
                        params.projectId,
                        params.channelId,
                        user.id
                    )
                    if (channel === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Channel not found' },
                        })
                    }
                    return { channel }
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
        .delete(
            '/api/projects/:projectId/channels/:channelId/image',
            {
                auth: true,
                params: channelParams,
                query: channelRevisionQuery,
                response: {
                    200: channelMutationResponse,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    413: errorResponse,
                    415: errorResponse,
                    422: errorResponse,
                    502: errorResponse,
                },
                detail: {
                    operationId: 'removeProjectChannelImage',
                    summary: 'Remove a channel identity image',
                    tags: ['Channels'],
                },
            },
            async ({ authMethod, params, query, status, user }) => {
                if (
                    !(await canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    }))
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const existingChannel = await loadChannelResponse(
                    params.projectId,
                    params.channelId,
                    user.id
                )
                if (existingChannel === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Channel not found' },
                    })
                }
                try {
                    const removed = await identityImages.removeChannelImage({
                        channelId: params.channelId,
                        projectId: params.projectId,
                        expectedRevision: query.expectedRevision,
                    })
                    if (!removed) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Channel not found' },
                        })
                    }
                    const channel = await loadChannelResponse(
                        params.projectId,
                        params.channelId,
                        user.id
                    )
                    if (channel === null) {
                        return status(404, {
                            error: { code: 'not_found', message: 'Channel not found' },
                        })
                    }
                    return { channel }
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
}
