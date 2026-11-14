import { describe, expect, it } from 'bun:test'

import {
    ChannelProfileCompiler,
    adaptSourceContentToProfile,
    applySourceContentToTarget,
} from '@postdot/core'

import {
    devtoArticleV1ChannelProfile,
    devtoChannelProfile,
    devtoChannelProfileValidationAdapter,
} from './profile'

const compiler = new ChannelProfileCompiler({
    validationAdapters: [devtoChannelProfileValidationAdapter],
})

describe('DEV.to channel profile', () => {
    it('maps a Postdot headline and body to a publishable article target without defaulting AI disclosure', () => {
        const target = adaptSourceContentToProfile(
            {
                headline: 'A Postdot article',
                body: { text: '# Hello DEV.to', format: 'markdown' },
                media: [],
            },
            devtoChannelProfile
        )

        expect(target).toEqual({
            title: 'A Postdot article',
            body_markdown: '# Hello DEV.to',
            media: [],
        })
        expect(target.ai_disclosure_level).toBeUndefined()
        expect(target.published).toBeUndefined()
        expect(compiler.compile(devtoChannelProfile).ok).toBe(true)
        expect(compiler.compile(devtoArticleV1ChannelProfile).ok).toBe(true)
    })

    it('preserves DEV.to target options when applying updated Postdot source content', () => {
        const updated = applySourceContentToTarget(
            {
                headline: 'Updated headline',
                body: { text: '# Updated markdown', format: 'markdown' },
                media: [],
            },
            devtoChannelProfile,
            {
                title: 'Old headline',
                body_markdown: '# Old markdown',
                media: [],
                tags: ['typescript', 'bun'],
                canonical_url: 'https://example.com/post',
                description: 'Concise summary',
                series: 'Release series',
                ai_disclosure_level: 'some_ai',
                published: false,
                organization_id: 42,
            }
        )

        expect(updated).toEqual({
            title: 'Updated headline',
            body_markdown: '# Updated markdown',
            media: [],
            tags: ['typescript', 'bun'],
            canonical_url: 'https://example.com/post',
            description: 'Concise summary',
            series: 'Release series',
            ai_disclosure_level: 'some_ai',
            published: false,
            organization_id: 42,
        })
    })

    it('requires a title because DEV.to articles cannot be published without one', () => {
        const compiled = compiler.compile(devtoChannelProfile)
        if (!compiled.ok) throw new Error('The DEV.to profile must compile')

        expect(compiled.value.validate({ body_markdown: 'Body', media: [] })).toMatchObject({
            ok: false,
        })
    })

    it('accepts all Forem article options and rejects invalid tags, canonical URLs, or blank fields', () => {
        const compiled = compiler.compile(devtoChannelProfile)
        if (!compiled.ok) throw new Error('The DEV.to profile must compile')

        expect(
            compiled.value.validate({
                title: 'A complete DEV.to article',
                body_markdown: '# Content',
                media: [],
                tags: ['typescript', 'javascript', 'api', 'oss'],
                canonical_url: 'https://example.com/canonical-post',
                description: 'Summary for previews and SEO',
                series: 'Postdot series',
                ai_disclosure_level: 'no_ai',
                published: false,
                organization_id: 99,
            })
        ).toEqual({ ok: true, value: expect.any(Object), issues: [] })

        expect(
            compiled.value.validate({
                title: 'Article',
                body_markdown: 'Body',
                media: [],
                tags: ['not-alphanumeric'],
            })
        ).toMatchObject({
            ok: false,
            issues: [expect.objectContaining({ path: '/tags/0', code: 'devto.tag_invalid' })],
        })

        expect(
            compiled.value.validate({
                title: 'Article',
                body_markdown: 'Body',
                media: [],
                tags: ['TypeScript', 'typescript'],
            })
        ).toMatchObject({
            ok: false,
            issues: [expect.objectContaining({ path: '/tags/1', code: 'devto.tags_duplicate' })],
        })

        expect(
            compiled.value.validate({
                title: 'Article',
                body_markdown: 'Body',
                media: [],
                tags: ['one', 'two', 'three', 'four', 'five'],
            })
        ).toMatchObject({ ok: false })

        expect(
            compiled.value.validate({
                title: 'Article',
                body_markdown: 'Body',
                media: [],
                canonical_url: 'https://user:secret@example.com/post',
            })
        ).toMatchObject({
            ok: false,
            issues: [
                expect.objectContaining({
                    path: '/canonical_url',
                    code: 'devto.canonical_url_invalid',
                }),
            ],
        })

        expect(
            compiled.value.validate({
                title: 'Article',
                body_markdown: 'Body',
                media: [],
                description: '   ',
                series: '   ',
            })
        ).toMatchObject({
            ok: false,
            issues: expect.arrayContaining([
                expect.objectContaining({ path: '/description', code: 'devto.text_blank' }),
                expect.objectContaining({ path: '/series', code: 'devto.text_blank' }),
            ]),
        })

        expect(
            compiled.value.validate({
                title: 'Article',
                body_markdown: 'Body',
                media: [],
                organization_id: 0,
            })
        ).toMatchObject({ ok: false })
    })
})
