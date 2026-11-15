import { DomainInvariantError } from '@postdot/core'
import {
    IdentityImageValidationError,
    IdentityImageAuthorizationError,
    identityImageMaxBytes,
    type AccessStore,
    type IdentityImageStore,
} from '@postdot/db'
import type { OpenAPIV3 } from 'openapi-types'
import { Type } from 'typebox'

import { readBoundedRequestBytes } from '../../request-body'
import { workspaceSchema } from '../access/workspace-schema'
import {
    createChannelAccessPolicy,
    type ChannelAccessPolicyInput,
} from '../projects/channel-access-policy'
import { channelSchema, projectSchema, errorResponse } from '../projects/models'
import type { ManualStore } from '../projects/types'
import { IdentityImageRemoteError, type IdentityImageResolver } from './resolver'

export const identityImageParams = Type.Object({
    sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
})

export const workspaceParams = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
})

export const setWebsiteBody = Type.Object({
    websiteUrl: Type.Union([Type.String({ maxLength: 2_048 }), Type.Null()]),
})

export const setChannelWebsiteBody = Type.Object({
    websiteUrl: Type.Union([Type.String({ maxLength: 2_048 }), Type.Null()]),
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
})

export const importImageUrlBody = Type.Object({
    url: Type.String({ minLength: 1, maxLength: 2_048 }),
})

export const importChannelImageUrlBody = Type.Object({
    url: Type.String({ minLength: 1, maxLength: 2_048 }),
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
})

export const channelRevisionQuery = Type.Object({
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
})

export const projectMutationResponse = Type.Object({
    project: projectSchema,
    warning: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

export const workspaceMutationResponse = Type.Object({
    workspace: workspaceSchema,
    warning: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

export const channelMutationResponse = Type.Object({
    channel: channelSchema,
    warning: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

export const identityErrorResponses = {
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    413: errorResponse,
    415: errorResponse,
    422: errorResponse,
    502: errorResponse,
}

const MULTIPART_ENVELOPE_OVERHEAD_BYTES = 128 * 1024

export const uploadRequestBodyDetail: OpenAPIV3.RequestBodyObject = {
    required: true,
    content: {
        'application/json': {
            schema: {
                type: 'object',
                required: ['base64'],
                additionalProperties: false,
                properties: {
                    base64: {
                        type: 'string',
                        minLength: 4,
                        maxLength: Math.ceil(identityImageMaxBytes / 3) * 4,
                        description:
                            'Base64-encoded raster image bytes (maximum decoded size 2 MB).',
                    },
                },
            },
        },
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

export async function extractUploadedImageBytes(request: Request): Promise<UploadExtractionResult> {
    const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
    const isMultipart = contentType.startsWith('multipart/form-data')
    const isJson = contentType.startsWith('application/json')
    const rawLimit = isJson
        ? Math.ceil(identityImageMaxBytes / 3) * 4 + 1024
        : isMultipart
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

    if (isJson) {
        try {
            const body: unknown = JSON.parse(new TextDecoder().decode(readResult.bytes))
            if (
                typeof body !== 'object' ||
                body === null ||
                !('base64' in body) ||
                typeof body.base64 !== 'string' ||
                body.base64.length % 4 !== 0 ||
                /[^A-Za-z0-9+/=]/.test(body.base64) ||
                body.base64.length === 0
            )
                throw new Error('Invalid base64')
            const decoded = Buffer.from(body.base64, 'base64')
            if (decoded.toString('base64') !== body.base64) throw new Error('Invalid base64')
            const bytes = new Uint8Array(decoded)
            if (bytes.byteLength > identityImageMaxBytes)
                return {
                    ok: false,
                    status: 413,
                    code: 'identity_image_size',
                    message: 'Image exceeds the 2 MB limit',
                }
            return { ok: true, bytes }
        } catch {
            return {
                ok: false,
                status: 400,
                code: 'invalid_input',
                message: 'Provide a base64-encoded image',
            }
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

export function identityRouteContext(options: IdentityImageRoutesOptions) {
    const { manualStore, access } = options

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
        readonly status: 400 | 403 | 409 | 413 | 415 | 422 | 502
        readonly body: { readonly error: { readonly code: string; readonly message: string } }
    } | null {
        if (error instanceof IdentityImageAuthorizationError)
            return { status: 403, body: { error: { code: error.code, message: error.message } } }
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

    return { loadProjectResponse, loadWorkspaceResponse, loadChannelResponse, mapIdentityError }
}

/** Uses live manager and attachment rules for both sessions and scoped API keys. */
export async function canManageChannelIdentity(
    options: IdentityImageRoutesOptions,
    input: Omit<ChannelAccessPolicyInput, 'access'> & { projectId: string; channelId: string }
) {
    const context = await options.manualStore.sharedChannels.contextFor({
        subjectId: input.userId,
        contextProjectId: input.projectId,
        authorization: createChannelAccessPolicy({ ...input, access: options.access }),
    })
    return (
        context !== null &&
        (await options.manualStore.sharedChannels.getCadence(context, input.channelId))
            ?.canManage === true
    )
}
