import { describe, expect, test } from 'bun:test'

import {
    countFirstCommentGraphemes,
    describeFirstCommentDelay,
    firstCommentAccepted,
    firstCommentCancellable,
    firstCommentConflicted,
    firstCommentDelayOptions,
    firstCommentDelayProblem,
    firstCommentEdited,
    firstCommentEditState,
    firstCommentExternalLinkAllowed,
    firstCommentFormEditable,
    firstCommentMaxDelaySeconds,
    firstCommentMaxGraphemes,
    firstCommentMaxTextLength,
    firstCommentReloaded,
    firstCommentSubmitRevision,
    firstCommentTextProblem,
    firstCommentVersion,
    type FirstCommentVersion,
    type PublicationFirstCommentItem,
    type PublicationFirstCommentResponse,
} from '@/lib/publication-first-comment'

function item(overrides: Partial<PublicationFirstCommentItem> = {}): PublicationFirstCommentItem {
    return {
        id: 'comment-1',
        text: 'Hello',
        delaySeconds: 0,
        state: 'waiting',
        revision: 1,
        dueAt: null,
        createdAt: 1,
        updatedAt: 1,
        externalUrl: null,
        lastError: null,
        authorName: 'Robin',
        ...overrides,
    }
}

function response(
    overrides: Partial<PublicationFirstCommentResponse> = {}
): PublicationFirstCommentResponse {
    return {
        providerId: 'bluesky',
        textLimit: 300,
        instanceOrigin: null,
        firstComment: null,
        canConfigure: false,
        canManage: false,
        ...overrides,
    }
}

function version(overrides: Partial<FirstCommentVersion> = {}): FirstCommentVersion {
    return {
        revision: 4,
        text: 'Hello',
        delaySeconds: 0,
        ...overrides,
    }
}

describe('first comment text rules', () => {
    test('counts graphemes so one emoji is one character', () => {
        expect(countFirstCommentGraphemes('👋')).toBe(1)
        expect(countFirstCommentGraphemes('👋🏽')).toBe(1)
        expect(countFirstCommentGraphemes('ab')).toBe(2)
    })

    test('rejects blank text and text above the grapheme limit', () => {
        expect(firstCommentTextProblem('   ')).toBe('empty')
        expect(firstCommentTextProblem('')).toBe('empty')
        expect(firstCommentTextProblem('a'.repeat(firstCommentMaxGraphemes))).toBeNull()
        expect(firstCommentTextProblem('a'.repeat(firstCommentMaxGraphemes + 1))).toBe('too_long')
    })

    test('rejects text above the UTF-16 unit limit even inside the grapheme limit', () => {
        // One family emoji is a single grapheme but eleven UTF-16 code units.
        const family = '👨‍👩‍👧‍👦'
        expect(countFirstCommentGraphemes(family)).toBe(1)
        expect(family.length).toBe(11)
        expect(firstCommentTextProblem(family.repeat(300))).toBe('too_long_units')
        expect(firstCommentTextProblem(family.repeat(200))).toBeNull()
        expect(firstCommentTextProblem('a'.repeat(firstCommentMaxTextLength + 1))).toBe('too_long')
    })
})

describe('first comment delay rules', () => {
    test('accepts only integer delays inside the product bound', () => {
        expect(firstCommentDelayProblem(0)).toBeNull()
        expect(firstCommentDelayProblem(firstCommentMaxDelaySeconds)).toBeNull()
        expect(firstCommentDelayProblem(-1)).toBe('out_of_range')
        expect(firstCommentDelayProblem(firstCommentMaxDelaySeconds + 1)).toBe('out_of_range')
        expect(firstCommentDelayProblem(1.5)).toBe('invalid')
        expect(firstCommentDelayProblem(Number.NaN)).toBe('invalid')
    })

    test('describes a stored delay with its exact unit', () => {
        expect(describeFirstCommentDelay(0)).toEqual({ value: 0, unit: 'immediate', amount: 0 })
        expect(describeFirstCommentDelay(300)).toEqual({ value: 300, unit: 'minutes', amount: 5 })
        expect(describeFirstCommentDelay(1800)).toEqual({
            value: 1800,
            unit: 'minutes',
            amount: 30,
        })
        expect(describeFirstCommentDelay(3600)).toEqual({ value: 3600, unit: 'hours', amount: 1 })
        expect(describeFirstCommentDelay(86400)).toEqual({ value: 86400, unit: 'days', amount: 1 })
        expect(describeFirstCommentDelay(604800)).toEqual({
            value: 604800,
            unit: 'days',
            amount: 7,
        })
        expect(describeFirstCommentDelay(90)).toEqual({ value: 90, unit: 'seconds', amount: 90 })
    })

    test('offers the presets and preserves a stored value that is not one', () => {
        expect(firstCommentDelayOptions(null).map(option => option.value)).toEqual([
            0, 300, 1800, 3600, 86400, 604800,
        ])
        expect(firstCommentDelayOptions(120).map(option => option.value)).toEqual([
            0, 120, 300, 1800, 3600, 86400, 604800,
        ])
        expect(firstCommentDelayOptions(300).map(option => option.value)).toEqual([
            0, 300, 1800, 3600, 86400, 604800,
        ])
        expect(firstCommentDelayOptions(-1).map(option => option.value)).toEqual([
            0, 300, 1800, 3600, 86400, 604800,
        ])
    })
})

describe('first comment state rules', () => {
    test('reads the live revision from the loaded comment', () => {
        expect(firstCommentVersion(null)).toEqual({
            revision: 0,
            text: '',
            delaySeconds: 0,
        })
        expect(firstCommentVersion(item({ revision: 4, delaySeconds: 300 }))).toEqual({
            revision: 4,
            text: 'Hello',
            delaySeconds: 300,
        })
    })

    test('offers the form only while the comment can still be changed', () => {
        expect(
            firstCommentFormEditable(response({ canConfigure: true, canManage: true }), false)
        ).toBe(true)
        expect(firstCommentFormEditable(response({ canConfigure: true }), false)).toBe(true)
        expect(
            firstCommentFormEditable(
                response({ canConfigure: true, canManage: true, firstComment: item() }),
                false
            )
        ).toBe(true)
        expect(
            firstCommentFormEditable(
                response({
                    canConfigure: true,
                    canManage: true,
                    firstComment: item({ state: 'suspended' }),
                }),
                false
            )
        ).toBe(true)
        expect(
            firstCommentFormEditable(
                response({
                    canConfigure: true,
                    canManage: true,
                    firstComment: item({ state: 'running' }),
                }),
                false
            )
        ).toBe(false)
        expect(
            firstCommentFormEditable(
                response({
                    canConfigure: true,
                    canManage: true,
                    firstComment: item({ state: 'sent' }),
                }),
                false
            )
        ).toBe(false)
        expect(
            firstCommentFormEditable(response({ canConfigure: false, canManage: true }), false)
        ).toBe(false)
        expect(
            firstCommentFormEditable(response({ canConfigure: true, canManage: true }), true)
        ).toBe(false)
    })

    test('cancels only an unsent comment', () => {
        expect(
            firstCommentCancellable(
                response({ canConfigure: true, canManage: true, firstComment: item() }),
                false
            )
        ).toBe(true)
        expect(
            firstCommentCancellable(
                response({
                    canConfigure: true,
                    canManage: true,
                    firstComment: item({ state: 'pending' }),
                }),
                false
            )
        ).toBe(true)
        expect(
            firstCommentCancellable(
                response({
                    canConfigure: true,
                    canManage: true,
                    firstComment: item({ state: 'suspended' }),
                }),
                false
            )
        ).toBe(true)
        expect(
            firstCommentCancellable(
                response({
                    canConfigure: true,
                    canManage: true,
                    firstComment: item({ state: 'running' }),
                }),
                false
            )
        ).toBe(false)
        expect(
            firstCommentCancellable(
                response({
                    canConfigure: true,
                    canManage: true,
                    firstComment: item({ state: 'cancelled' }),
                }),
                false
            )
        ).toBe(false)
        expect(firstCommentCancellable(response({ canConfigure: true }), false)).toBe(false)
        expect(
            firstCommentCancellable(response({ canConfigure: true, canManage: true }), false)
        ).toBe(false)
    })
})

describe('first comment edit baseline', () => {
    test('presents the live revision while nothing was edited', () => {
        const state = firstCommentEditState()
        expect(firstCommentSubmitRevision(state, version({ revision: 4 }))).toBe(4)
    })

    test('freezes the revision and the initial values when editing starts', () => {
        const live = version({ revision: 4, text: 'Hello', delaySeconds: 300 })
        const state = firstCommentEdited(firstCommentEditState(), live, { text: 'Hello world' })

        expect(state.baseline).toEqual({ revision: 4, text: 'Hello', delaySeconds: 300 })
        expect(state.draftText).toBe('Hello world')
        expect(firstCommentSubmitRevision(state, live)).toBe(4)
    })

    test('does not let a background refresh advance the baseline', () => {
        const state = firstCommentEdited(firstCommentEditState(), version({ revision: 4 }), {
            text: 'Hello world',
        })
        // The realtime refresh moved the server to revision 5 while the form
        // still holds the operator's text.
        const refreshed = version({ revision: 5, text: 'Someone else' })

        expect(firstCommentSubmitRevision(state, refreshed)).toBe(4)
        expect(state.draftText).toBe('Hello world')
    })

    test('keeps the local text and delay when the save is refused', () => {
        const edited = firstCommentEdited(firstCommentEditState(), version({ revision: 4 }), {
            text: 'Hello world',
            delaySeconds: 1800,
        })
        const refused = firstCommentConflicted(
            edited,
            version({ revision: 5, text: 'Someone else', delaySeconds: 0 })
        )

        expect(refused.draftText).toBe('Hello world')
        expect(refused.draftDelaySeconds).toBe(1800)
        expect(refused.conflict?.revision).toBe(5)
        expect(refused.conflict?.text).toBe('Someone else')
    })

    test('resubmits against the reviewed version only while the conflict is visible', () => {
        const edited = firstCommentEdited(firstCommentEditState(), version({ revision: 4 }), {
            text: 'Hello world',
        })
        const refused = firstCommentConflicted(edited, version({ revision: 5 }))

        expect(firstCommentSubmitRevision(refused, version({ revision: 5 }))).toBe(5)

        const accepted = firstCommentAccepted(refused, refused.editCount, version({ revision: 6 }))
        expect(accepted.conflict).toBeNull()
        expect(accepted.baseline?.revision).toBe(6)
        expect(accepted.draftText).toBeNull()
    })

    test('reviews the current version again after an explicit reload', () => {
        const edited = firstCommentEdited(firstCommentEditState(), version({ revision: 4 }), {
            text: 'Hello world',
        })
        const refused = firstCommentConflicted(edited, version({ revision: 5 }))
        const reloaded = firstCommentReloaded(refused, version({ revision: 5 }))

        expect(reloaded.draftText).toBeNull()
        expect(reloaded.draftDelaySeconds).toBeNull()
        expect(reloaded.conflict).toBeNull()
        expect(reloaded.baseline?.revision).toBe(5)
        expect(firstCommentSubmitRevision(reloaded, version({ revision: 5 }))).toBe(5)
    })

    test('keeps input typed while the request was pending', () => {
        const edited = firstCommentEdited(firstCommentEditState(), version({ revision: 4 }), {
            text: 'Hello world',
        })
        const typed = firstCommentEdited(edited, version({ revision: 4 }), { text: 'Hello again' })
        const accepted = firstCommentAccepted(typed, edited.editCount, version({ revision: 5 }))

        expect(accepted.draftText).toBe('Hello again')
        expect(accepted.baseline?.revision).toBe(5)
    })

    test('clears the local draft when no newer edit arrived', () => {
        const edited = firstCommentEdited(firstCommentEditState(), version({ revision: 4 }), {
            text: 'Hello world',
        })
        const accepted = firstCommentAccepted(edited, edited.editCount, version({ revision: 5 }))

        expect(accepted.draftText).toBeNull()
        expect(accepted.baseline?.revision).toBe(5)
    })
})

describe('first comment external link', () => {
    test('accepts only a Bluesky permalink', () => {
        expect(
            firstCommentExternalLinkAllowed('https://bsky.app/profile/did/app.bsky.feed.post/1')
        ).toBe(true)
        expect(firstCommentExternalLinkAllowed('https://example.com/post/1')).toBe(false)
        expect(
            firstCommentExternalLinkAllowed('http://bsky.app/profile/did/app.bsky.feed.post/1')
        ).toBe(false)
        expect(firstCommentExternalLinkAllowed('javascript:alert(1)')).toBe(false)
        expect(firstCommentExternalLinkAllowed(null)).toBe(false)
    })

    test('rejects a permalink that carries userinfo', () => {
        expect(firstCommentExternalLinkAllowed('https://bsky.app@evil.example/post/1')).toBe(false)
        expect(
            firstCommentExternalLinkAllowed(
                'https://user@bsky.app/profile/did/app.bsky.feed.post/1'
            )
        ).toBe(false)
        expect(
            firstCommentExternalLinkAllowed('https://user:pass@bsky.app/profile/did/post/1')
        ).toBe(false)
    })
})

describe('Mastodon prepared comment envelope', () => {
    test('uses its conservative UTF-16 limit without the Bluesky grapheme ceiling', () => {
        expect(firstCommentTextProblem('a'.repeat(500), 'mastodon')).toBeNull()
        expect(firstCommentTextProblem('a'.repeat(501), 'mastodon')).toBe('too_long_units')
        expect(firstCommentTextProblem('👋'.repeat(250), 'mastodon')).toBeNull()
        expect(firstCommentTextProblem('👋'.repeat(251), 'mastodon')).toBe('too_long_units')
        expect(firstCommentTextProblem(' ', 'mastodon')).toBe('empty')
    })
    test('only opens a Mastodon link on the pinned instance origin', () => {
        expect(
            firstCommentExternalLinkAllowed(
                'https://social.example/@owner/123',
                'mastodon',
                'https://social.example'
            )
        ).toBe(true)
        expect(
            firstCommentExternalLinkAllowed(
                'https://other.example/@owner/123',
                'mastodon',
                'https://social.example'
            )
        ).toBe(false)
        expect(
            firstCommentExternalLinkAllowed(
                'https://user@social.example/@owner/123',
                'mastodon',
                'https://social.example'
            )
        ).toBe(false)
        expect(
            firstCommentExternalLinkAllowed('https://social.example/@owner/123', 'mastodon', null)
        ).toBe(false)
    })
})
