import { describe, expect, it } from 'bun:test'

import {
    createProject,
    createProjectCategory,
    createProjectTag,
    createPublicationTagFilter,
    DomainInvariantError,
    normalizeTaxonomyLabel,
    publicationTagFilterMaximumIds,
} from './index'

describe('taxonomy domain vocabulary', () => {
    it('normalizes Unicode labels without changing intentional casing in the display name', () => {
        expect(normalizeTaxonomyLabel('  Release   Notes  ')).toEqual({
            name: 'Release Notes',
            normalizedName: 'release notes',
        })
        expect(normalizeTaxonomyLabel('ＲＥＬＥＡＳＥ　ＮＯＴＥＳ')).toEqual({
            name: 'RELEASE NOTES',
            normalizedName: 'release notes',
        })
    })

    it('rejects blank and overlong labels at the domain boundary', () => {
        expect(() => normalizeTaxonomyLabel(' \u2003 ')).toThrow(DomainInvariantError)
        expect(() => normalizeTaxonomyLabel('x'.repeat(121))).toThrow(
            'name must not be longer than 120 characters'
        )
        expect(() => normalizeTaxonomyLabel('İ'.repeat(120))).toThrow(
            'name must not be longer than 120 characters after normalization'
        )
    })

    it('creates opaque category and project-scoped tag identities', () => {
        const project = createProject({
            id: 'project-1',
            workspaceId: 'workspace-1',
            name: 'Project',
            now: 100,
        })
        const category = createProjectCategory({
            id: 'category-opaque-1',
            name: 'Launch',
            now: 100,
        })
        const tag = createProjectTag({
            id: 'tag-opaque-1',
            project,
            name: ' Customer-facing ',
            now: 100,
        })

        expect(category).toMatchObject({
            id: 'category-opaque-1',
            name: 'Launch',
            normalizedName: 'launch',
            state: 'active',
            archivedAt: null,
        })
        expect(tag).toMatchObject({
            id: 'tag-opaque-1',
            projectId: project.id,
            name: 'Customer-facing',
            normalizedName: 'customer-facing',
            state: 'active',
            archivedAt: null,
        })
    })

    it('canonicalizes a bounded stable-ID publication tag filter', () => {
        expect(createPublicationTagFilter(['tag-b', 'tag-a', 'tag-b'])).toEqual({
            tagIds: ['tag-a', 'tag-b'],
        })
        expect(() => createPublicationTagFilter([' '])).toThrow(DomainInvariantError)
        expect(() =>
            createPublicationTagFilter(
                Array.from(
                    { length: publicationTagFilterMaximumIds + 1 },
                    (_, index) => `tag-${index}`
                )
            )
        ).toThrow('may contain at most 20 tag IDs')
    })
})
