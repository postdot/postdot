import type { BlueskyThreadReader } from '@postdot/bluesky'
import type { AccessStore, PublicationCommentStore } from '@postdot/db'
import type { MastodonThreadReader } from '@postdot/mastodon'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { createProviderCommentsReaders } from '../../providers/comments-readers'
import { canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import { errorResponse, publicationParams } from './models'
import {
    publicationCommentsResponseSchema,
    publicationCommentSnapshotSchema,
    commentFailureSchema,
    type PublicationCommentsResponse,
} from './publication-comments-models'
import type { AuthenticatedElysia, ManualStore } from './types'

export function registerPublicationCommentsRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    options: {
        store: PublicationCommentStore
        manual: ManualStore
        access: AccessStore
        reader?: BlueskyThreadReader
        mastodonReader?: MastodonThreadReader
        now?: () => number
    }
) {
    const readers = createProviderCommentsReaders(options)
    const now = options.now ?? Date.now
    function identity(projectId: string, publicationId: string, subjectId: string) {
        const editor = options.manual.getPublicationEditorState(projectId, publicationId, subjectId)
        if (editor === null || editor.publication.state !== 'published') return null
        const execution = editor.profile.profile.execution
        const rootUri = editor.publication.externalId
        if (execution.kind !== 'built_in' || rootUri === null) return null
        const base = { projectId, publicationId, subjectId, externalId: rootUri }
        const reader = readers.find(reader => reader.id === execution.contractId)
        const source = reader?.resolve(rootUri, editor.publication.externalUrl)
        return reader && source
            ? {
                  ...base,
                  provider: reader.id,
                  rootUri: source.rootUri,
                  ...('externalUrl' in source ? { externalUrl: source.externalUrl } : {}),
                  refresh: source.refresh,
              }
            : null
    }

    function stored(
        input: NonNullable<ReturnType<typeof identity>>
    ): PublicationCommentsResponse | null {
        const row = options.store.read(input)
        if (row === undefined) return null
        const decoded: unknown =
            row?.snapshotJson === null || row === null ? null : JSON.parse(row.snapshotJson)
        if (decoded !== null && !Value.Check(publicationCommentSnapshotSchema, decoded)) {
            throw new Error('Stored comment snapshot is invalid')
        }
        const snapshot = decoded
        return {
            publicationId: input.publicationId,
            provider: input.provider,
            snapshot,
            lastAttemptAt: row?.lastAttemptAt ?? null,
            lastError:
                row?.lastError !== null &&
                row?.lastError !== undefined &&
                Value.Check(commentFailureSchema, row.lastError)
                    ? row.lastError
                    : null,
        }
    }
    const response = {
        200: publicationCommentsResponseSchema,
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        422: errorResponse,
    }
    return app
        .get(
            '/api/projects/:projectId/publications/:publicationId/comments',
            {
                auth: true,
                params: publicationParams,
                response,
                detail: {
                    operationId: 'getPublicationComments',
                    summary: 'Read the stored comment snapshot',
                    tags: ['Publications'],
                },
            },
            ({ params, user, status }) => {
                const input = identity(params.projectId, params.publicationId, user.id)
                const result = input === null ? null : stored(input)
                return (
                    result ??
                    status(404, {
                        error: {
                            code: 'not_found',
                            message: 'Supported published publication not found',
                        },
                    })
                )
            }
        )
        .post(
            '/api/projects/:projectId/publications/:publicationId/comments/refresh',
            {
                auth: true,
                params: publicationParams,
                body: Type.Object({}),
                response,
                detail: {
                    operationId: 'refreshPublicationComments',
                    summary: 'Refresh the latest public comment snapshot',
                    tags: ['Publications'],
                },
            },
            async ({ params, user, authMethod, status }) => {
                if (
                    !canAccessProjectRole({
                        access: options.access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                )
                    return status(403, forbiddenProjectMutation())
                const input = identity(params.projectId, params.publicationId, user.id)
                if (input === null)
                    return status(404, {
                        error: {
                            code: 'not_found',
                            message: 'Supported published publication not found',
                        },
                    })
                const attemptedAt = now()
                const refreshed = await input.refresh(attemptedAt)
                const { read, snapshot } = refreshed
                const keepSnapshot =
                    read.kind === 'unavailable' &&
                    !['blocked', 'not_found', 'disabled'].includes(read.availability)
                const saved = options.store.saveAttempt({
                    ...input,
                    lastAttemptAt: attemptedAt,
                    snapshotJson: keepSnapshot ? null : JSON.stringify(snapshot),
                    lastError:
                        keepSnapshot && read.kind === 'unavailable' ? read.availability : null,
                })
                const result = saved ? stored(input) : null
                return (
                    result ??
                    status(404, {
                        error: {
                            code: 'not_found',
                            message: 'Supported published publication not found',
                        },
                    })
                )
            }
        )
}
