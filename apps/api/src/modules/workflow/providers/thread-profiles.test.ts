import { expect, it } from 'bun:test'

import {
    blueskyThreadChannelProfile,
    blueskyChannelProfileValidationAdapter,
} from '@postdot/bluesky'
import { ChannelProfileCompiler, applySourceContentToTarget } from '@postdot/core'
import {
    mastodonThreadChannelProfile,
    mastodonChannelProfileValidationAdapter,
} from '@postdot/mastodon'
import { xThreadChannelProfile, xChannelProfileValidationAdapter } from '@postdot/x'

const compiler = new ChannelProfileCompiler({
    validationAdapters: [
        xChannelProfileValidationAdapter,
        blueskyChannelProfileValidationAdapter,
        mastodonChannelProfileValidationAdapter,
    ],
})

for (const [profile, invalidText] of [
    [xThreadChannelProfile, '日'.repeat(141)],
    [blueskyThreadChannelProfile, 'é'.repeat(301)],
    [mastodonThreadChannelProfile, 'a'.repeat(501)],
] as const) {
    it(`validates ${profile.id} continuations and preserves them when the source changes`, () => {
        const compiled = compiler.compile(profile)
        expect(compiled.ok).toBe(true)
        if (!compiled.ok) throw new Error('Profile did not compile')
        const content = {
            ...(profile.id === 'mastodon' ? { visibility: 'public' } : {}),
            text: 'First',
            media: [],
            thread: [{ text: 'Second' }, { text: 'Third' }],
        }
        expect(compiled.value.validate(content).ok).toBe(true)
        expect(
            compiled.value.validate({
                ...content,
                thread: [{ text: 'Second' }, { text: invalidText }],
            }).issues
        ).toContainEqual(expect.objectContaining({ path: '/thread/1/text', severity: 'error' }))
        expect(compiled.value.validate({ ...content, thread: [{ text: ' ' }] }).ok).toBe(false)
        const adapted = applySourceContentToTarget(
            { body: { text: 'Edited first message', format: 'plain_text' }, media: [] },
            profile,
            content
        )
        expect(adapted).toEqual({ ...content, text: 'Edited first message' })
    })
}

it('excludes direct Mastodon threads without losing poll validation', () => {
    const compiled = compiler.compile(mastodonThreadChannelProfile)
    if (!compiled.ok) throw new Error('Profile did not compile')
    const content = { text: 'First', media: [], visibility: 'public', thread: [{ text: 'Second' }] }
    expect(compiled.value.validate({ ...content, visibility: undefined }).ok).toBe(false)
    expect(compiled.value.validate({ ...content, visibility: 'direct' }).issues).toContainEqual(
        expect.objectContaining({ path: '/visibility', code: 'mastodon.thread_visibility' })
    )
    expect(
        compiled.value.validate({
            ...content,
            poll: { options: ['First', 'Second'], expiresIn: 1 },
        }).issues
    ).toContainEqual(expect.objectContaining({ path: '/poll/expiresIn', code: 'schema.minimum' }))
})
