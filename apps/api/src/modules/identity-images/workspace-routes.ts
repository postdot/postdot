import type { AuthenticatedElysia } from '../projects/types'
import {
    identityRouteContext,
    identityErrorResponses,
    type IdentityImageRoutesOptions,
    workspaceParams,
    setWebsiteBody,
    importImageUrlBody,
    workspaceMutationResponse,
    uploadRequestBodyDetail,
    extractUploadedImageBytes,
} from './shared'

export function registerWorkspaceIdentityRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    options: IdentityImageRoutesOptions
) {
    const { identityImages, resolver, access } = options
    const { loadWorkspaceResponse, mapIdentityError } = identityRouteContext(options)
    return app
        .put(
            '/api/workspaces/:workspaceId/website',
            {
                auth: true,
                params: workspaceParams,
                body: setWebsiteBody,
                response: { 200: workspaceMutationResponse, ...identityErrorResponses },
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
                            authorize: () => access.canManageWorkspace(params.workspaceId, user.id),
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
                        authorize: () => access.canManageWorkspace(params.workspaceId, user.id),
                        workspaceId: params.workspaceId,
                        websiteUrl: resolved.normalizedWebsiteUrl,
                        faviconImage: resolved.favicon ?? undefined,
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
                response: { 200: workspaceMutationResponse, ...identityErrorResponses },
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
                        authorize: () => access.canManageWorkspace(params.workspaceId, user.id),
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
                response: { 200: workspaceMutationResponse, ...identityErrorResponses },
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
                        authorize: () => access.canManageWorkspace(params.workspaceId, user.id),
                        workspaceId: params.workspaceId,
                        bytes: downloaded.bytes,
                        processedImage: downloaded,
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
                response: { 200: workspaceMutationResponse, ...identityErrorResponses },
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
                        authorize: () => access.canManageWorkspace(params.workspaceId, user.id),
                        workspaceId: params.workspaceId,
                        bytes: favicon.bytes,
                        processedImage: favicon,
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
                response: { 200: workspaceMutationResponse, ...identityErrorResponses },
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
                try {
                    await identityImages.removeWorkspaceImage(params.workspaceId, () =>
                        access.canManageWorkspace(params.workspaceId, user.id)
                    )
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
}
