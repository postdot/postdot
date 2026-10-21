import type { AccessStore, TaxonomyStore } from '@postdot/db'
import { Type } from 'typebox'

import { sessionSecurity } from '../../plugins/auth'
import { canAccessProjectRole, forbiddenProjectMutation } from './authorization'
import {
    categoryParams,
    createProjectCategoryBody,
    createProjectTagBody,
    errorResponse,
    projectCategoriesSchema,
    projectCategorySchema,
    projectParams,
    projectSchema,
    projectTagSchema,
    projectTagsSchema,
    publicationTagParams,
    renameProjectCategoryBody,
    renameProjectTagBody,
    replacePublicationTagsBody,
    setProjectPrimaryCategoryBody,
    tagParams,
    taxonomyListQuery,
} from './models'
import type { AuthenticatedElysia } from './types'

/**
 * Categories are instance-level definitions. Human sessions may read them for
 * project context and filters; only enabled instance administrators may mutate
 * them. User API keys are never accepted on this instance surface.
 */
export function registerTaxonomyRoutes<const Routes extends Record<string, unknown>>(
    app: AuthenticatedElysia<Routes>,
    taxonomy: TaxonomyStore,
    access: AccessStore
) {
    return app
        .get(
            '/api/categories',
            {
                auth: true,
                query: taxonomyListQuery,
                response: {
                    200: projectCategoriesSchema,
                    401: errorResponse,
                    403: errorResponse,
                },
                detail: {
                    operationId: 'listProjectCategories',
                    summary: 'List instance project categories',
                    tags: ['Taxonomy'],
                },
            },
            ({ authMethod, query, status }) => {
                if (authMethod !== 'session') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message: 'A human session is required to read project categories',
                        },
                    })
                }
                return {
                    categories: taxonomy.listCategories(query.includeArchived === true),
                }
            }
        )
        .post(
            '/api/categories',
            {
                auth: true,
                body: createProjectCategoryBody,
                response: {
                    201: Type.Object({ category: projectCategorySchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'createProjectCategory',
                    summary: 'Create an instance project category',
                    tags: ['Taxonomy'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, status, user }) => {
                if (authMethod !== 'session' || !access.isInstanceAdmin(user.id)) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message:
                                'An instance administrator session is required for project category administration',
                        },
                    })
                }
                return status(201, { category: taxonomy.createCategory({ name: body.name }) })
            }
        )
        .patch(
            '/api/categories/:categoryId',
            {
                auth: true,
                body: renameProjectCategoryBody,
                params: categoryParams,
                response: {
                    200: Type.Object({ category: projectCategorySchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'renameProjectCategory',
                    summary: 'Rename an instance project category',
                    tags: ['Taxonomy'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (authMethod !== 'session' || !access.isInstanceAdmin(user.id)) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message:
                                'An instance administrator session is required for project category administration',
                        },
                    })
                }
                const category = taxonomy.renameCategory({
                    categoryId: params.categoryId,
                    name: body.name,
                })
                if (category === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project category not found' },
                    })
                }
                return { category }
            }
        )
        .post(
            '/api/categories/:categoryId/archive',
            {
                auth: true,
                params: categoryParams,
                response: {
                    200: Type.Object({ category: projectCategorySchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'archiveProjectCategory',
                    summary: 'Archive an instance project category',
                    tags: ['Taxonomy'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (authMethod !== 'session' || !access.isInstanceAdmin(user.id)) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message:
                                'An instance administrator session is required for project category administration',
                        },
                    })
                }
                const category = taxonomy.archiveCategory({ categoryId: params.categoryId })
                if (category === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project category not found' },
                    })
                }
                return { category }
            }
        )
        .post(
            '/api/categories/:categoryId/restore',
            {
                auth: true,
                params: categoryParams,
                response: {
                    200: Type.Object({ category: projectCategorySchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'restoreProjectCategory',
                    summary: 'Restore an archived instance project category',
                    tags: ['Taxonomy'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, params, status, user }) => {
                if (authMethod !== 'session' || !access.isInstanceAdmin(user.id)) {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message:
                                'An instance administrator session is required for project category administration',
                        },
                    })
                }
                const category = taxonomy.restoreCategory({ categoryId: params.categoryId })
                if (category === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project category not found' },
                    })
                }
                return { category }
            }
        )
        .patch(
            '/api/projects/:projectId/category',
            {
                auth: true,
                body: setProjectPrimaryCategoryBody,
                params: projectParams,
                response: {
                    200: projectSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'setProjectPrimaryCategory',
                    summary: 'Set or clear a project primary category',
                    tags: ['Taxonomy'],
                    security: sessionSecurity,
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (authMethod !== 'session') {
                    return status(403, {
                        error: {
                            code: 'forbidden',
                            message:
                                'Human authentication is required for project category administration',
                        },
                    })
                }
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const project = taxonomy.setProjectPrimaryCategory({
                    projectId: params.projectId,
                    subjectId: user.id,
                    categoryId: body.categoryId,
                })
                if (project === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project or category not found' },
                    })
                }
                return project
            }
        )
        .get(
            '/api/projects/:projectId/tags',
            {
                auth: true,
                params: projectParams,
                query: taxonomyListQuery,
                response: {
                    200: projectTagsSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listProjectTags',
                    summary: 'List project-scoped publication tags',
                    tags: ['Taxonomy'],
                },
            },
            ({ params, query, status, user }) => {
                const tags = taxonomy.listProjectTags({
                    projectId: params.projectId,
                    subjectId: user.id,
                    includeArchived: query.includeArchived,
                })
                if (tags === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return { tags }
            }
        )
        .post(
            '/api/projects/:projectId/tags',
            {
                auth: true,
                body: createProjectTagBody,
                params: projectParams,
                response: {
                    201: Type.Object({ tag: projectTagSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'createProjectTag',
                    summary: 'Create a project-scoped publication tag',
                    tags: ['Taxonomy'],
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const tag = taxonomy.createTag({
                    projectId: params.projectId,
                    subjectId: user.id,
                    name: body.name,
                })
                if (tag === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project not found' },
                    })
                }
                return status(201, { tag })
            }
        )
        .patch(
            '/api/projects/:projectId/tags/:tagId',
            {
                auth: true,
                body: renameProjectTagBody,
                params: tagParams,
                response: {
                    200: Type.Object({ tag: projectTagSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'renameProjectTag',
                    summary: 'Rename a project-scoped publication tag',
                    tags: ['Taxonomy'],
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const tag = taxonomy.renameTag({
                    projectId: params.projectId,
                    subjectId: user.id,
                    tagId: params.tagId,
                    name: body.name,
                })
                if (tag === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project tag not found' },
                    })
                }
                return { tag }
            }
        )
        .post(
            '/api/projects/:projectId/tags/:tagId/archive',
            {
                auth: true,
                params: tagParams,
                response: {
                    200: Type.Object({ tag: projectTagSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'archiveProjectTag',
                    summary: 'Archive a project-scoped publication tag',
                    tags: ['Taxonomy'],
                },
            },
            ({ authMethod, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const tag = taxonomy.archiveTag({
                    projectId: params.projectId,
                    subjectId: user.id,
                    tagId: params.tagId,
                })
                if (tag === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project tag not found' },
                    })
                }
                return { tag }
            }
        )
        .post(
            '/api/projects/:projectId/tags/:tagId/restore',
            {
                auth: true,
                params: tagParams,
                response: {
                    200: Type.Object({ tag: projectTagSchema }),
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                },
                detail: {
                    operationId: 'restoreProjectTag',
                    summary: 'Restore an archived project-scoped publication tag',
                    tags: ['Taxonomy'],
                },
            },
            ({ authMethod, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const tag = taxonomy.restoreTag({
                    projectId: params.projectId,
                    subjectId: user.id,
                    tagId: params.tagId,
                })
                if (tag === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Project tag not found' },
                    })
                }
                return { tag }
            }
        )
        .get(
            '/api/projects/:projectId/publications/:publicationId/tags',
            {
                auth: true,
                params: publicationTagParams,
                query: taxonomyListQuery,
                response: {
                    200: projectTagsSchema,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                },
                detail: {
                    operationId: 'listPublicationTags',
                    summary: 'List tags assigned to a publication',
                    tags: ['Taxonomy'],
                },
            },
            ({ params, query, status, user }) => {
                const tags = taxonomy.listPublicationTags({
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    subjectId: user.id,
                    includeArchived: query.includeArchived ?? true,
                })
                if (tags === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }
                return { tags }
            }
        )
        .put(
            '/api/projects/:projectId/publications/:publicationId/tags',
            {
                auth: true,
                body: replacePublicationTagsBody,
                params: publicationTagParams,
                response: {
                    200: projectTagsSchema,
                    400: errorResponse,
                    401: errorResponse,
                    403: errorResponse,
                    404: errorResponse,
                    409: errorResponse,
                    422: errorResponse,
                },
                detail: {
                    operationId: 'replacePublicationTags',
                    summary: 'Replace a publication tag set',
                    tags: ['Taxonomy'],
                },
            },
            ({ authMethod, body, params, status, user }) => {
                if (
                    !canAccessProjectRole({
                        access,
                        authMethod,
                        minimumRole: 'editor',
                        projectId: params.projectId,
                        userId: user.id,
                    })
                ) {
                    return status(403, forbiddenProjectMutation())
                }
                const tags = taxonomy.replacePublicationTags({
                    projectId: params.projectId,
                    publicationId: params.publicationId,
                    subjectId: user.id,
                    tagIds: body.tagIds,
                })
                if (tags === null) {
                    return status(404, {
                        error: { code: 'not_found', message: 'Publication not found' },
                    })
                }
                return { tags }
            }
        )
}
