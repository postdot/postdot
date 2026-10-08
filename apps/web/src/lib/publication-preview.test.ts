import { describe, expect, test } from 'bun:test'

import {
    getDraftPreviewModel,
    getPreviewTarget,
    getTargetPreviewBody,
    getTargetPreviewTitle,
} from './publication-preview'

describe('publication draft preview model', () => {
    test('uses a non-blank channel adaptation and keeps the DEV.to title', () => {
        expect(
            getDraftPreviewModel({
                postContent: 'Shared content',
                postTitle: 'Release notes',
                platform: 'devto',
                targetContent: 'DEV.to body',
            })
        ).toEqual({
            body: 'DEV.to body',
            hasText: true,
            showTitle: true,
            title: 'Release notes',
        })
    })

    test('keeps an explicitly blank channel adaptation blank', () => {
        expect(
            getDraftPreviewModel({
                postContent: 'Shared content',
                postTitle: 'Internal title',
                platform: 'bluesky',
                targetContent: '  \n',
            })
        ).toEqual({
            body: '  \n',
            hasText: false,
            showTitle: false,
            title: 'Internal title',
        })
    })

    test('marks a media-only draft as textually empty without inventing copy', () => {
        expect(
            getDraftPreviewModel({
                postContent: '   ',
                postTitle: '',
                platform: 'custom',
            })
        ).toEqual({
            body: '   ',
            hasText: false,
            showTitle: false,
            title: '',
        })
    })
})

describe('destination preview headline', () => {
    const profile = {
        fieldBindings: [{ id: 'title', semantic: 'headline', path: '/article/title' }],
    }

    test('uses the declared destination field rather than a guessed title property', () => {
        expect(
            getTargetPreviewTitle(profile, {
                title: 'Internal metadata',
                article: { title: 'Destination headline' },
            })
        ).toBe('Destination headline')
    })

    test('preserves a blank adaptation and does not invent missing content', () => {
        expect(getTargetPreviewTitle(profile, { article: { title: '' } })).toBe('')
        expect(getTargetPreviewTitle(profile, { title: 'Unbound title' })).toBe('')
        expect(getTargetPreviewTitle(profile, null)).toBe('')
        expect(getTargetPreviewTitle({}, { title: 'Unbound title' })).toBe('')
    })
})

describe('destination preview body (UX-298)', () => {
    test('reads a nested primary_text binding instead of guessing a top-level key', () => {
        const profile = {
            fieldBindings: [
                { id: 'title', semantic: 'headline', path: '/meta/label' },
                { id: 'article', semantic: 'primary_text', path: '/article/body' },
            ],
        }

        expect(
            getTargetPreviewBody(profile, {
                content: 'A top-level string that is not the declared body',
                meta: { label: 'Destination headline' },
                article: { body: 'Destination body' },
            })
        ).toBe('Destination body')
    })

    test('reads a custom profile binding declared at a top-level custom path', () => {
        const profile = {
            fieldBindings: [{ id: 'payload', semantic: 'primary_text', path: '/messageBody' }],
        }

        expect(
            getTargetPreviewBody(profile, {
                body: 'Preset body that this profile never declares',
                messageBody: 'Custom destination body',
            })
        ).toBe('Custom destination body')
    })

    test('does not substitute a guessed key when the declared field is absent', () => {
        const profile = {
            fieldBindings: [{ id: 'article', semantic: 'primary_text', path: '/article/body' }],
        }

        expect(getTargetPreviewBody(profile, { content: 'Unbound text' })).toBe('')
        expect(getTargetPreviewBody(profile, { article: {} })).toBe('')
    })

    test('preserves an intentionally empty adaptation', () => {
        const profile = {
            fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
        }

        expect(getTargetPreviewBody(profile, { body: '' })).toBe('')
        expect(getTargetPreviewBody(profile, { body: '  \n' })).toBe('  \n')
    })

    test('yields nothing for a missing document or an unbound profile', () => {
        expect(getTargetPreviewBody({}, { body: 'Anything' })).toBe('')
        expect(getTargetPreviewBody({ fieldBindings: [] }, { body: 'Anything' })).toBe('')
        expect(getTargetPreviewBody({ fieldBindings: [] }, null)).toBe('')
    })

    test('ignores a non-textual declared field rather than converting it to text', () => {
        const profile = {
            fieldBindings: [{ id: 'article', semantic: 'primary_text', path: '/article' }],
        }

        expect(getTargetPreviewBody(profile, { article: { blocks: ['one'] } })).toBe('')
    })
})

describe('preview target selection (UX-298)', () => {
    const working = { title: 'Newer draft title', body: 'Newer draft body' }
    const selected = { title: 'Selected title', body: 'Selected execution body' }

    test('reads the working target while the publication is editable', () => {
        expect(
            getPreviewTarget({ editable: true, workingTarget: working, selectedTarget: selected })
        ).toBe(working)
    })

    test('reads the selected execution target once the publication is locked', () => {
        expect(
            getPreviewTarget({ editable: false, workingTarget: working, selectedTarget: selected })
        ).toBe(selected)
    })

    test('falls back to the working target when nothing was selected yet', () => {
        expect(
            getPreviewTarget({ editable: false, workingTarget: working, selectedTarget: null })
        ).toBe(working)
        expect(
            getPreviewTarget({ editable: true, workingTarget: null, selectedTarget: selected })
        ).toBe(null)
    })

    test('headline, body and media cannot disagree about the revision', () => {
        const locked = getPreviewTarget({
            editable: false,
            workingTarget: working,
            selectedTarget: selected,
        })
        const profile = {
            fieldBindings: [
                { id: 'title', semantic: 'headline', path: '/title' },
                { id: 'body', semantic: 'primary_text', path: '/body' },
            ],
        }
        // One selector, so a later unapplied draft cannot reach any of the three.
        expect(locked).toBe(selected)
        expect(getTargetPreviewTitle(profile, locked)).toBe('Selected title')
        expect(getTargetPreviewBody(profile, locked)).toBe('Selected execution body')
    })
})
