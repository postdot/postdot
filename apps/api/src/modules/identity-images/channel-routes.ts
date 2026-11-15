import { channelParams } from '../projects/models'
import type { AuthenticatedElysia } from '../projects/types'
import {
    identityRouteContext,
    identityErrorResponses,
    canManageChannelIdentity,
    type IdentityImageRoutesOptions,
    setChannelWebsiteBody,
    importChannelImageUrlBody,
    channelRevisionQuery,
    channelMutationResponse,
    uploadRequestBodyDetail,
    extractUploadedImageBytes,
} from './shared'

export function registerChannelIdentityRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    options: IdentityImageRoutesOptions
) {
    const { identityImages, resolver } = options
    const { loadChannelResponse, mapIdentityError } = identityRouteContext(options)
    return app
        .put(
            '/api/projects/:projectId/channels/:channelId/website',
            {
                auth: true,
                params: channelParams,
                body: setChannelWebsiteBody,
                response: { 200: channelMutationResponse, ...identityErrorResponses },
                detail: {
                    operationId: 'setProjectChannelWebsite',
                    summary: 'Set or clear a channel website URL',
                    tags: ['Channels'],
                },
            },
            async ({
                authMethod,
                apiKeyPermissions,
                apiKeyProjectIds,
                body,
                params,
                status,
                user,
            }) => {
                const canManage = () =>
                    canManageChannelIdentity(options, {
                        projectId: params.projectId,
                        channelId: params.channelId,
                        userId: user.id,
                        authMethod,
                        apiKeyPermissions,
                        apiKeyProjectIds,
                    })
                if (!(await canManage()))
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Channel management access is required',
                        },
                    })
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
                            authorize: canManage,
                            channelId: params.channelId,
                            projectId: params.projectId,
                            expectedRevision: body.expectedRevision ?? existingChannel.revision,
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
                        authorize: canManage,
                        channelId: params.channelId,
                        projectId: params.projectId,
                        expectedRevision: body.expectedRevision ?? existingChannel.revision,
                        websiteUrl: resolved.normalizedWebsiteUrl,
                        faviconImage: resolved.favicon ?? undefined,
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
                response: { 200: channelMutationResponse, ...identityErrorResponses },
                detail: {
                    operationId: 'uploadProjectChannelImage',
                    summary: 'Upload a channel identity image',
                    tags: ['Channels'],
                    requestBody: uploadRequestBodyDetail,
                },
            },
            async ({
                authMethod,
                apiKeyPermissions,
                apiKeyProjectIds,
                params,
                query,
                request,
                status,
                user,
            }) => {
                const canManage = () =>
                    canManageChannelIdentity(options, {
                        projectId: params.projectId,
                        channelId: params.channelId,
                        userId: user.id,
                        authMethod,
                        apiKeyPermissions,
                        apiKeyProjectIds,
                    })
                if (!(await canManage()))
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Channel management access is required',
                        },
                    })
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
                        authorize: canManage,
                        channelId: params.channelId,
                        projectId: params.projectId,
                        expectedRevision:
                            query.expectedRevision ??
                            extracted.expectedRevision ??
                            existingChannel.revision,
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
                response: { 200: channelMutationResponse, ...identityErrorResponses },
                detail: {
                    operationId: 'importProjectChannelImageUrl',
                    summary: 'Set a channel identity image from a URL',
                    tags: ['Channels'],
                },
            },
            async ({
                authMethod,
                apiKeyPermissions,
                apiKeyProjectIds,
                body,
                params,
                status,
                user,
            }) => {
                const canManage = () =>
                    canManageChannelIdentity(options, {
                        projectId: params.projectId,
                        channelId: params.channelId,
                        userId: user.id,
                        authMethod,
                        apiKeyPermissions,
                        apiKeyProjectIds,
                    })
                if (!(await canManage()))
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Channel management access is required',
                        },
                    })
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
                        authorize: canManage,
                        channelId: params.channelId,
                        projectId: params.projectId,
                        expectedRevision: body.expectedRevision ?? existingChannel.revision,
                        bytes: downloaded.bytes,
                        processedImage: downloaded,
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
                response: { 200: channelMutationResponse, ...identityErrorResponses },
                detail: {
                    operationId: 'useProjectChannelWebsiteIcon',
                    summary: 'Use the channel website favicon as its identity image',
                    tags: ['Channels'],
                },
            },
            async ({
                authMethod,
                apiKeyPermissions,
                apiKeyProjectIds,
                params,
                query,
                status,
                user,
            }) => {
                const canManage = () =>
                    canManageChannelIdentity(options, {
                        projectId: params.projectId,
                        channelId: params.channelId,
                        userId: user.id,
                        authMethod,
                        apiKeyPermissions,
                        apiKeyProjectIds,
                    })
                if (!(await canManage()))
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Channel management access is required',
                        },
                    })
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
                        authorize: canManage,
                        channelId: params.channelId,
                        projectId: params.projectId,
                        expectedRevision: query.expectedRevision ?? existingChannel.revision,
                        bytes: favicon.bytes,
                        processedImage: favicon,
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
                response: { 200: channelMutationResponse, ...identityErrorResponses },
                detail: {
                    operationId: 'removeProjectChannelImage',
                    summary: 'Remove a channel identity image',
                    tags: ['Channels'],
                },
            },
            async ({
                authMethod,
                apiKeyPermissions,
                apiKeyProjectIds,
                params,
                query,
                status,
                user,
            }) => {
                const canManage = () =>
                    canManageChannelIdentity(options, {
                        projectId: params.projectId,
                        channelId: params.channelId,
                        userId: user.id,
                        authMethod,
                        apiKeyPermissions,
                        apiKeyProjectIds,
                    })
                if (!(await canManage()))
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'Channel management access is required',
                        },
                    })
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
                        authorize: canManage,
                        channelId: params.channelId,
                        projectId: params.projectId,
                        expectedRevision: query.expectedRevision ?? existingChannel.revision,
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
