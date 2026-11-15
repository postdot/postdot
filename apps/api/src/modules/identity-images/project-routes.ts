import { canAccessProjectRole, forbiddenProjectMutation } from '../projects/authorization'
import { projectParams } from '../projects/models'
import type { AuthenticatedElysia } from '../projects/types'
import {
    identityRouteContext,
    identityErrorResponses,
    type IdentityImageRoutesOptions,
    setWebsiteBody,
    importImageUrlBody,
    projectMutationResponse,
    uploadRequestBodyDetail,
    extractUploadedImageBytes,
} from './shared'

export function registerProjectIdentityRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    options: IdentityImageRoutesOptions
) {
    const { identityImages, resolver, access } = options
    const { loadProjectResponse, mapIdentityError } = identityRouteContext(options)
    return app
        .put(
            '/api/projects/:projectId/website',
            {
                auth: true,
                params: projectParams,
                body: setWebsiteBody,
                response: { 200: projectMutationResponse, ...identityErrorResponses },
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
                            authorize: () =>
                                access.canAccessProject(params.projectId, user.id, 'editor'),
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
                        authorize: () =>
                            access.canAccessProject(params.projectId, user.id, 'editor'),
                        projectId: params.projectId,
                        websiteUrl: resolved.normalizedWebsiteUrl,
                        faviconImage: resolved.favicon ?? undefined,
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
                response: { 200: projectMutationResponse, ...identityErrorResponses },
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
                        authorize: () =>
                            access.canAccessProject(params.projectId, user.id, 'editor'),
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
                response: { 200: projectMutationResponse, ...identityErrorResponses },
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
                        authorize: () =>
                            access.canAccessProject(params.projectId, user.id, 'editor'),
                        projectId: params.projectId,
                        bytes: downloaded.bytes,
                        processedImage: downloaded,
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
                response: { 200: projectMutationResponse, ...identityErrorResponses },
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
                        authorize: () =>
                            access.canAccessProject(params.projectId, user.id, 'editor'),
                        projectId: params.projectId,
                        bytes: favicon.bytes,
                        processedImage: favicon,
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
                response: { 200: projectMutationResponse, ...identityErrorResponses },
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
                try {
                    const removed = await identityImages.removeProjectImage(params.projectId, () =>
                        access.canAccessProject(params.projectId, user.id, 'editor')
                    )
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
                } catch (error) {
                    const mapped = mapIdentityError(error)
                    if (mapped) return status(mapped.status, mapped.body)
                    throw error
                }
            }
        )
}
