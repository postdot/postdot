import {
    createProjectCategory,
    createProjectTag,
    DomainInvariantError,
    normalizeTaxonomyLabel,
    requireNonBlank,
    requireTimestamp,
    type Project,
    type ProjectCategory,
    type ProjectTag,
} from '@postdot/core'

import { defineTransaction, recordDatabaseCommitProject, type PostdotDatabase } from './client'
import { toProject } from './manual-store/project-channel-mappers'
import type { ProjectRow } from './manual-store/rows'
import { isUniqueConstraintError } from './sql/dialect'

interface TaxonomyCategoryRow {
    readonly id: string
    readonly name: string
    readonly normalizedName: string
    readonly state: ProjectCategory['state']
    readonly archivedAt: number | null
    readonly createdAt: number
    readonly updatedAt: number
}

interface TaxonomyTagRow {
    readonly id: string
    readonly projectId: string
    readonly name: string
    readonly normalizedName: string
    readonly state: ProjectTag['state']
    readonly archivedAt: number | null
    readonly createdAt: number
    readonly updatedAt: number
}

interface TaxonomyStoreOptions {
    readonly now?: () => number
    readonly createId?: () => string
}

export interface CreateProjectCategoryInput {
    readonly name: string
}

export interface RenameProjectCategoryInput {
    readonly categoryId: string
    readonly name: string
}

export interface ProjectCategoryLifecycleInput {
    readonly categoryId: string
}

export interface SetProjectPrimaryCategoryInput {
    readonly projectId: string
    readonly subjectId: string
    readonly categoryId: string | null
}

export interface CreateProjectTagInput {
    readonly projectId: string
    readonly subjectId: string
    readonly name: string
}

export interface RenameProjectTagInput {
    readonly projectId: string
    readonly subjectId: string
    readonly tagId: string
    readonly name: string
}

export interface ProjectTagLifecycleInput {
    readonly projectId: string
    readonly subjectId: string
    readonly tagId: string
}

export interface ListProjectTagsInput {
    readonly projectId: string
    readonly subjectId: string
    readonly includeArchived?: boolean
}

export interface ListPublicationTagsInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly includeArchived?: boolean
}

export interface ReplacePublicationTagsInput {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly tagIds: readonly string[]
}

function toProjectCategory(row: TaxonomyCategoryRow): ProjectCategory {
    return {
        id: row.id,
        name: row.name,
        normalizedName: row.normalizedName,
        state: row.state,
        archivedAt: row.archivedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toProjectTag(row: TaxonomyTagRow): ProjectTag {
    return {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        normalizedName: row.normalizedName,
        state: row.state,
        archivedAt: row.archivedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function taxonomyConflict(kind: 'category' | 'tag', name: string): DomainInvariantError {
    return new DomainInvariantError(
        'write_conflict',
        `A ${kind} with the normalized name "${name}" already exists in this scope`
    )
}

function sortTagIds(tags: ReadonlyMap<string, TaxonomyTagRow>, tagIds: readonly string[]) {
    return [...tagIds].sort((left, right) => {
        const leftTag = tags.get(left)
        const rightTag = tags.get(right)
        if (leftTag === undefined || rightTag === undefined) {
            return left < right ? -1 : left > right ? 1 : 0
        }
        if (leftTag.normalizedName < rightTag.normalizedName) return -1
        if (leftTag.normalizedName > rightTag.normalizedName) return 1
        return left < right ? -1 : left > right ? 1 : 0
    })
}

export function createTaxonomyStore(database: PostdotDatabase, options: TaxonomyStoreOptions = {}) {
    const sql = database.sql
    const now = options.now ?? Date.now
    const createId = options.createId ?? (() => crypto.randomUUID())

    const loadProjectStatement = sql.statement<ProjectRow, [projectId: string]>(`
        select id,
               name,
               time_zone as timeZone,
               workspace_id as workspaceId,
               primary_category_id as primaryCategoryId,
               created_at as createdAt,
               updated_at as updatedAt
        from projects
        where id = ?1
    `)
    const loadActorStatement = sql.statement<
        { readonly id: string },
        [projectId: string, subjectId: string]
    >(`
        select id
        from actors
        where project_id = ?1
          and subject_id = ?2
          and kind in ('human', 'agent', 'api_token')
        order by created_at, id
        limit 1
    `)
    const listCategoriesStatement = sql.statement<TaxonomyCategoryRow, [includeArchived: number]>(`
        select id,
               name,
               normalized_name as normalizedName,
               state,
               archived_at as archivedAt,
               created_at as createdAt,
               updated_at as updatedAt
        from project_categories
        where ?1 = 1 or state = 'active'
        order by normalized_name, id
    `)
    const loadCategoryStatement = sql.statement<TaxonomyCategoryRow, [categoryId: string]>(`
        select id,
               name,
               normalized_name as normalizedName,
               state,
               archived_at as archivedAt,
               created_at as createdAt,
               updated_at as updatedAt
        from project_categories
        where id = ?1
    `)
    const loadCategoryByNormalizedNameStatement = sql.statement<
        TaxonomyCategoryRow,
        [normalizedName: string]
    >(`
        select id,
               name,
               normalized_name as normalizedName,
               state,
               archived_at as archivedAt,
               created_at as createdAt,
               updated_at as updatedAt
        from project_categories
        where normalized_name = ?1
        limit 1
    `)
    const insertCategoryStatement = sql.statement<
        void,
        [id: string, name: string, normalizedName: string, createdAt: number]
    >(`
        insert into project_categories (
            id, name, normalized_name, state, archived_at, created_at, updated_at
        ) values (?1, ?2, ?3, 'active', null, ?4, ?4)
    `)
    const renameCategoryStatement = sql.statement<
        { readonly changes: number },
        [name: string, normalizedName: string, updatedAt: number, categoryId: string]
    >(`
        update project_categories
        set name = ?1,
            normalized_name = ?2,
            updated_at = ?3
        where id = ?4
    `)
    const archiveCategoryStatement = sql.statement<
        { readonly changes: number },
        [archivedAt: number, categoryId: string]
    >(`
        update project_categories
        set state = 'archived',
            archived_at = ?1,
            updated_at = ?1
        where id = ?2
          and state = 'active'
    `)
    const restoreCategoryStatement = sql.statement<
        { readonly changes: number },
        [updatedAt: number, categoryId: string]
    >(`
        update project_categories
        set state = 'active',
            archived_at = null,
            updated_at = ?1
        where id = ?2
          and state = 'archived'
    `)
    const setProjectCategoryStatement = sql.statement<
        { readonly changes: number },
        [categoryId: string | null, updatedAt: number, projectId: string]
    >(`
        update projects
        set primary_category_id = ?1,
            updated_at = ?2
        where id = ?3
    `)

    const loadTagStatement = sql.statement<TaxonomyTagRow, [projectId: string, tagId: string]>(`
        select id,
               project_id as projectId,
               name,
               normalized_name as normalizedName,
               state,
               archived_at as archivedAt,
               created_at as createdAt,
               updated_at as updatedAt
        from project_tags
        where project_id = ?1
          and id = ?2
    `)
    const loadTagByNormalizedNameStatement = sql.statement<
        TaxonomyTagRow,
        [projectId: string, normalizedName: string]
    >(`
        select id,
               project_id as projectId,
               name,
               normalized_name as normalizedName,
               state,
               archived_at as archivedAt,
               created_at as createdAt,
               updated_at as updatedAt
        from project_tags
        where project_id = ?1
          and normalized_name = ?2
        limit 1
    `)
    const listProjectTagsStatement = sql.statement<
        TaxonomyTagRow,
        [projectId: string, includeArchived: number]
    >(`
        select id,
               project_id as projectId,
               name,
               normalized_name as normalizedName,
               state,
               archived_at as archivedAt,
               created_at as createdAt,
               updated_at as updatedAt
        from project_tags
        where project_id = ?1
          and (?2 = 1 or state = 'active')
        order by normalized_name, id
    `)
    const insertTagStatement = sql.statement<
        void,
        [id: string, projectId: string, name: string, normalizedName: string, createdAt: number]
    >(`
        insert into project_tags (
            id, project_id, name, normalized_name, state, archived_at, created_at, updated_at
        ) values (?1, ?2, ?3, ?4, 'active', null, ?5, ?5)
    `)
    const renameTagStatement = sql.statement<
        { readonly changes: number },
        [name: string, normalizedName: string, updatedAt: number, projectId: string, tagId: string]
    >(`
        update project_tags
        set name = ?1,
            normalized_name = ?2,
            updated_at = ?3
        where project_id = ?4
          and id = ?5
    `)
    const archiveTagStatement = sql.statement<
        { readonly changes: number },
        [archivedAt: number, projectId: string, tagId: string]
    >(`
        update project_tags
        set state = 'archived',
            archived_at = ?1,
            updated_at = ?1
        where project_id = ?2
          and id = ?3
          and state = 'active'
    `)
    const restoreTagStatement = sql.statement<
        { readonly changes: number },
        [updatedAt: number, projectId: string, tagId: string]
    >(`
        update project_tags
        set state = 'active',
            archived_at = null,
            updated_at = ?1
        where project_id = ?2
          and id = ?3
          and state = 'archived'
    `)
    const loadPublicationStatement = sql.statement<
        { readonly id: string },
        [projectId: string, publicationId: string]
    >(`
        select id
        from publications
        where project_id = ?1
          and id = ?2
    `)
    const listPublicationTagIdsStatement = sql.statement<
        { readonly tagId: string },
        [projectId: string, publicationId: string]
    >(`
        select tag_id as tagId
        from publication_tags
        where project_id = ?1
          and publication_id = ?2
    `)
    const listPublicationTagsStatement = sql.statement<
        TaxonomyTagRow,
        [projectId: string, publicationId: string, includeArchived: number]
    >(`
        select tags.id,
               tags.project_id as projectId,
               tags.name,
               tags.normalized_name as normalizedName,
               tags.state,
               tags.archived_at as archivedAt,
               tags.created_at as createdAt,
               tags.updated_at as updatedAt
        from publication_tags as assignments
        inner join project_tags as tags
            on tags.project_id = assignments.project_id
           and tags.id = assignments.tag_id
        where assignments.project_id = ?1
          and assignments.publication_id = ?2
          and (?3 = 1 or tags.state = 'active')
        order by tags.normalized_name, tags.id
    `)
    const deletePublicationTagsStatement = sql.statement<
        { readonly changes: number },
        [projectId: string, publicationId: string]
    >(`
        delete from publication_tags
        where project_id = ?1
          and publication_id = ?2
    `)
    const insertPublicationTagStatement = sql.statement<
        void,
        [projectId: string, publicationId: string, tagId: string, createdAt: number]
    >(`
        insert into publication_tags (project_id, publication_id, tag_id, created_at)
        values (?1, ?2, ?3, ?4)
    `)
    const insertAuditEventStatement = sql.statement<
        void,
        [
            id: string,
            projectId: string,
            actorId: string,
            action: string,
            entityType: string,
            entityId: string,
            metadataJson: string | null,
            createdAt: number,
        ]
    >(`
        insert into audit_events (
            id,
            project_id,
            actor_id,
            action,
            entity_type,
            entity_id,
            metadata_json,
            created_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `)

    const createCategoryTransaction = defineTransaction(
        database,
        async (input: CreateProjectCategoryInput): Promise<ProjectCategory> => {
            const timestamp = requireTimestamp(now(), 'now')
            const label = normalizeTaxonomyLabel(input.name)
            if ((await loadCategoryByNormalizedNameStatement.get(label.normalizedName)) !== null) {
                throw taxonomyConflict('category', label.name)
            }

            const category = createProjectCategory({
                id: createId(),
                name: label.name,
                now: timestamp,
            })
            try {
                await insertCategoryStatement.run(
                    category.id,
                    category.name,
                    category.normalizedName,
                    timestamp
                )
            } catch (error) {
                if (isUniqueConstraintError(error))
                    throw taxonomyConflict('category', category.name)
                throw error
            }
            return category
        }
    )

    const renameCategoryTransaction = defineTransaction(
        database,
        async (input: RenameProjectCategoryInput): Promise<ProjectCategory | null> => {
            const categoryId = requireNonBlank(input.categoryId, 'categoryId')
            const current = await loadCategoryStatement.get(categoryId)
            if (current === null) return null

            const label = normalizeTaxonomyLabel(input.name)
            const duplicate = await loadCategoryByNormalizedNameStatement.get(label.normalizedName)
            if (duplicate !== null && duplicate.id !== categoryId) {
                throw taxonomyConflict('category', label.name)
            }

            const timestamp = requireTimestamp(now(), 'now')
            try {
                await renameCategoryStatement.run(
                    label.name,
                    label.normalizedName,
                    timestamp,
                    categoryId
                )
            } catch (error) {
                if (isUniqueConstraintError(error)) throw taxonomyConflict('category', label.name)
                throw error
            }
            return toProjectCategory(
                (await loadCategoryStatement.get(categoryId)) ?? {
                    ...current,
                    name: label.name,
                    normalizedName: label.normalizedName,
                    updatedAt: timestamp,
                }
            )
        }
    )

    const archiveCategoryTransaction = defineTransaction(
        database,
        async (input: ProjectCategoryLifecycleInput): Promise<ProjectCategory | null> => {
            const categoryId = requireNonBlank(input.categoryId, 'categoryId')
            const current = await loadCategoryStatement.get(categoryId)
            if (current === null) return null
            if (current.state !== 'active') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot archive an ${current.state} category`
                )
            }

            const timestamp = requireTimestamp(now(), 'now')
            await archiveCategoryStatement.run(timestamp, categoryId)
            return toProjectCategory(
                (await loadCategoryStatement.get(categoryId)) ?? {
                    ...current,
                    state: 'archived',
                    archivedAt: timestamp,
                    updatedAt: timestamp,
                }
            )
        }
    )

    const restoreCategoryTransaction = defineTransaction(
        database,
        async (input: ProjectCategoryLifecycleInput): Promise<ProjectCategory | null> => {
            const categoryId = requireNonBlank(input.categoryId, 'categoryId')
            const current = await loadCategoryStatement.get(categoryId)
            if (current === null) return null
            if (current.state !== 'archived') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot restore an ${current.state} category`
                )
            }

            const timestamp = requireTimestamp(now(), 'now')
            await restoreCategoryStatement.run(timestamp, categoryId)
            return toProjectCategory(
                (await loadCategoryStatement.get(categoryId)) ?? {
                    ...current,
                    state: 'active',
                    archivedAt: null,
                    updatedAt: timestamp,
                }
            )
        }
    )

    const setProjectCategoryTransaction = defineTransaction(
        database,
        async (input: SetProjectPrimaryCategoryInput): Promise<Project | null> => {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            if ((await loadActorStatement.get(projectId, subjectId)) === null) return null

            const currentProject = await loadProjectStatement.get(projectId)
            if (currentProject === null) return null

            const categoryId =
                input.categoryId === null ? null : requireNonBlank(input.categoryId, 'categoryId')
            if (categoryId !== null) {
                const category = await loadCategoryStatement.get(categoryId)
                if (category === null) return null
                if (
                    category.state !== 'active' &&
                    currentProject.primaryCategoryId !== category.id
                ) {
                    throw new DomainInvariantError(
                        'invalid_transition',
                        'Archived categories cannot be assigned to a project'
                    )
                }
            }

            const project = toProject(currentProject)
            if (project.primaryCategoryId === categoryId) return project

            const timestamp = requireTimestamp(now(), 'now')
            const update = await setProjectCategoryStatement.run(categoryId, timestamp, projectId)
            if (update.changes !== 1) return null
            recordDatabaseCommitProject(database, projectId)
            const actor = await loadActorStatement.get(projectId, subjectId)
            if (actor !== null) {
                await insertAuditEventStatement.run(
                    createId(),
                    projectId,
                    actor.id,
                    categoryId === null ? 'project.category_cleared' : 'project.category_assigned',
                    'project',
                    projectId,
                    JSON.stringify({ categoryId }),
                    timestamp
                )
            }

            return { ...project, primaryCategoryId: categoryId, updatedAt: timestamp }
        }
    )

    const createTagTransaction = defineTransaction(
        database,
        async (input: CreateProjectTagInput): Promise<ProjectTag | null> => {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const actor = await loadActorStatement.get(projectId, subjectId)
            const projectRow = await loadProjectStatement.get(projectId)
            if (actor === null || projectRow === null) return null

            const label = normalizeTaxonomyLabel(input.name)
            if (
                (await loadTagByNormalizedNameStatement.get(projectId, label.normalizedName)) !==
                null
            ) {
                throw taxonomyConflict('tag', label.name)
            }

            const timestamp = requireTimestamp(now(), 'now')
            const tag = createProjectTag({
                id: createId(),
                project: toProject(projectRow),
                name: label.name,
                now: timestamp,
            })
            try {
                await insertTagStatement.run(
                    tag.id,
                    tag.projectId,
                    tag.name,
                    tag.normalizedName,
                    timestamp
                )
            } catch (error) {
                if (isUniqueConstraintError(error)) throw taxonomyConflict('tag', tag.name)
                throw error
            }
            recordDatabaseCommitProject(database, projectId)
            await insertAuditEventStatement.run(
                createId(),
                projectId,
                actor.id,
                'project_tag.created',
                'project_tag',
                tag.id,
                JSON.stringify({ name: tag.name }),
                timestamp
            )
            return tag
        }
    )

    const renameTagTransaction = defineTransaction(
        database,
        async (input: RenameProjectTagInput): Promise<ProjectTag | null> => {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const actor = await loadActorStatement.get(projectId, subjectId)
            const tagId = requireNonBlank(input.tagId, 'tagId')
            const current = await loadTagStatement.get(projectId, tagId)
            if (actor === null || current === null) return null

            const label = normalizeTaxonomyLabel(input.name)
            const duplicate = await loadTagByNormalizedNameStatement.get(
                projectId,
                label.normalizedName
            )
            if (duplicate !== null && duplicate.id !== tagId) {
                throw taxonomyConflict('tag', label.name)
            }

            const timestamp = requireTimestamp(now(), 'now')
            try {
                await renameTagStatement.run(
                    label.name,
                    label.normalizedName,
                    timestamp,
                    projectId,
                    tagId
                )
            } catch (error) {
                if (isUniqueConstraintError(error)) throw taxonomyConflict('tag', label.name)
                throw error
            }
            recordDatabaseCommitProject(database, projectId)
            await insertAuditEventStatement.run(
                createId(),
                projectId,
                actor.id,
                'project_tag.renamed',
                'project_tag',
                tagId,
                JSON.stringify({ name: label.name }),
                timestamp
            )
            return toProjectTag(
                (await loadTagStatement.get(projectId, tagId)) ?? {
                    ...current,
                    name: label.name,
                    normalizedName: label.normalizedName,
                    updatedAt: timestamp,
                }
            )
        }
    )

    const archiveTagTransaction = defineTransaction(
        database,
        async (input: ProjectTagLifecycleInput): Promise<ProjectTag | null> => {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const actor = await loadActorStatement.get(projectId, subjectId)
            const tagId = requireNonBlank(input.tagId, 'tagId')
            const current = await loadTagStatement.get(projectId, tagId)
            if (actor === null || current === null) return null
            if (current.state !== 'active') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot archive an ${current.state} tag`
                )
            }

            const timestamp = requireTimestamp(now(), 'now')
            await archiveTagStatement.run(timestamp, projectId, tagId)
            recordDatabaseCommitProject(database, projectId)
            await insertAuditEventStatement.run(
                createId(),
                projectId,
                actor.id,
                'project_tag.archived',
                'project_tag',
                tagId,
                JSON.stringify({ archivedAt: timestamp }),
                timestamp
            )
            return toProjectTag(
                (await loadTagStatement.get(projectId, tagId)) ?? {
                    ...current,
                    state: 'archived',
                    archivedAt: timestamp,
                    updatedAt: timestamp,
                }
            )
        }
    )

    const restoreTagTransaction = defineTransaction(
        database,
        async (input: ProjectTagLifecycleInput): Promise<ProjectTag | null> => {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const actor = await loadActorStatement.get(projectId, subjectId)
            const tagId = requireNonBlank(input.tagId, 'tagId')
            const current = await loadTagStatement.get(projectId, tagId)
            if (actor === null || current === null) return null
            if (current.state !== 'archived') {
                throw new DomainInvariantError(
                    'invalid_transition',
                    `Cannot restore an ${current.state} tag`
                )
            }

            const timestamp = requireTimestamp(now(), 'now')
            await restoreTagStatement.run(timestamp, projectId, tagId)
            recordDatabaseCommitProject(database, projectId)
            await insertAuditEventStatement.run(
                createId(),
                projectId,
                actor.id,
                'project_tag.restored',
                'project_tag',
                tagId,
                null,
                timestamp
            )
            return toProjectTag(
                (await loadTagStatement.get(projectId, tagId)) ?? {
                    ...current,
                    state: 'active',
                    archivedAt: null,
                    updatedAt: timestamp,
                }
            )
        }
    )

    const replacePublicationTagsTransaction = defineTransaction(
        database,
        async (input: ReplacePublicationTagsInput): Promise<ProjectTag[] | null> => {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const actor = await loadActorStatement.get(projectId, subjectId)
            const publicationId = requireNonBlank(input.publicationId, 'publicationId')
            if (
                actor === null ||
                (await loadPublicationStatement.get(projectId, publicationId)) === null
            ) {
                return null
            }

            const tags = new Map(
                (await listProjectTagsStatement.all(projectId, 1)).map(
                    tag => [tag.id, tag] as const
                )
            )
            const requestedIds = [
                ...new Set(input.tagIds.map(tagId => requireNonBlank(tagId, 'tagId'))),
            ]
            const currentIds = new Set(
                (await listPublicationTagIdsStatement.all(projectId, publicationId)).map(
                    assignment => assignment.tagId
                )
            )
            for (const tagId of requestedIds) {
                const tag = tags.get(tagId)
                if (tag === undefined) {
                    throw new DomainInvariantError(
                        'invalid_input',
                        'Every publication tag must belong to the project'
                    )
                }
                if (tag.state === 'archived' && !currentIds.has(tagId)) {
                    throw new DomainInvariantError(
                        'invalid_transition',
                        'Archived tags cannot be newly assigned to a publication'
                    )
                }
            }

            const orderedIds = sortTagIds(tags, requestedIds)
            const unchanged =
                orderedIds.length === currentIds.size &&
                orderedIds.every(tagId => currentIds.has(tagId))
            if (unchanged) {
                return (await listPublicationTagsStatement.all(projectId, publicationId, 1)).map(
                    toProjectTag
                )
            }

            const timestamp = requireTimestamp(now(), 'now')
            await deletePublicationTagsStatement.run(projectId, publicationId)
            for (const tagId of orderedIds) {
                await insertPublicationTagStatement.run(projectId, publicationId, tagId, timestamp)
            }
            recordDatabaseCommitProject(database, projectId)
            await insertAuditEventStatement.run(
                createId(),
                projectId,
                actor.id,
                'publication.tags_replaced',
                'publication',
                publicationId,
                JSON.stringify({ tagIds: orderedIds }),
                timestamp
            )
            return (await listPublicationTagsStatement.all(projectId, publicationId, 1)).map(
                toProjectTag
            )
        }
    )

    return {
        async listCategories(includeArchived = false): Promise<ProjectCategory[]> {
            return (await listCategoriesStatement.all(includeArchived ? 1 : 0)).map(
                toProjectCategory
            )
        },

        async createCategory(input: CreateProjectCategoryInput): Promise<ProjectCategory> {
            return createCategoryTransaction.immediate({
                name: requireNonBlank(input.name, 'name'),
            })
        },

        async renameCategory(input: RenameProjectCategoryInput): Promise<ProjectCategory | null> {
            return renameCategoryTransaction.immediate({
                ...input,
                categoryId: requireNonBlank(input.categoryId, 'categoryId'),
                name: requireNonBlank(input.name, 'name'),
            })
        },

        async archiveCategory(
            input: ProjectCategoryLifecycleInput
        ): Promise<ProjectCategory | null> {
            return archiveCategoryTransaction.immediate(input)
        },

        async restoreCategory(
            input: ProjectCategoryLifecycleInput
        ): Promise<ProjectCategory | null> {
            return restoreCategoryTransaction.immediate(input)
        },

        async setProjectPrimaryCategory(
            input: SetProjectPrimaryCategoryInput
        ): Promise<Project | null> {
            return setProjectCategoryTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },

        async listProjectTags(input: ListProjectTagsInput): Promise<ProjectTag[] | null> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            // One read snapshot for the authorization check and the listing.
            return sql.transaction(async () => {
                if ((await loadActorStatement.get(projectId, subjectId)) === null) return null
                const rows = await listProjectTagsStatement.all(
                    projectId,
                    input.includeArchived === true ? 1 : 0
                )
                return rows.map(toProjectTag)
            })
        },

        async createTag(input: CreateProjectTagInput): Promise<ProjectTag | null> {
            return createTagTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                name: requireNonBlank(input.name, 'name'),
            })
        },

        async renameTag(input: RenameProjectTagInput): Promise<ProjectTag | null> {
            return renameTagTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                tagId: requireNonBlank(input.tagId, 'tagId'),
                name: requireNonBlank(input.name, 'name'),
            })
        },

        async archiveTag(input: ProjectTagLifecycleInput): Promise<ProjectTag | null> {
            return archiveTagTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                tagId: requireNonBlank(input.tagId, 'tagId'),
            })
        },

        async restoreTag(input: ProjectTagLifecycleInput): Promise<ProjectTag | null> {
            return restoreTagTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
                tagId: requireNonBlank(input.tagId, 'tagId'),
            })
        },

        async listPublicationTags(input: ListPublicationTagsInput): Promise<ProjectTag[] | null> {
            const projectId = requireNonBlank(input.projectId, 'projectId')
            const subjectId = requireNonBlank(input.subjectId, 'subjectId')
            const publicationId = requireNonBlank(input.publicationId, 'publicationId')
            return sql.transaction(async () => {
                if (
                    (await loadActorStatement.get(projectId, subjectId)) === null ||
                    (await loadPublicationStatement.get(projectId, publicationId)) === null
                ) {
                    return null
                }
                const rows = await listPublicationTagsStatement.all(
                    projectId,
                    publicationId,
                    input.includeArchived === true ? 1 : 0
                )
                return rows.map(toProjectTag)
            })
        },

        async replacePublicationTags(
            input: ReplacePublicationTagsInput
        ): Promise<ProjectTag[] | null> {
            return replacePublicationTagsTransaction.immediate({
                ...input,
                projectId: requireNonBlank(input.projectId, 'projectId'),
                publicationId: requireNonBlank(input.publicationId, 'publicationId'),
                subjectId: requireNonBlank(input.subjectId, 'subjectId'),
            })
        },
    }
}

export type TaxonomyStore = ReturnType<typeof createTaxonomyStore>
