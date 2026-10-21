import { expect, test } from 'bun:test'

import {
    adaptSourceContentToProfile,
    applySourceContentToTarget,
    ChannelProfileCompiler,
} from '@postdot/core'

import { facebookChannelProfile, facebookChannelProfileValidationAdapter } from './profile'
import { FACEBOOK_MAX_PHOTO_BYTES } from './publisher'

function compiledProfile() {
    const result = new ChannelProfileCompiler({
        validationAdapters: [facebookChannelProfileValidationAdapter],
    }).compile(facebookChannelProfile)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Facebook profile did not compile')
    return result.value
}

test('the Facebook profile accepts text, link or one photo without inventing a title', () => {
    const profile = compiledProfile()
    for (const content of [
        { text: 'Announcement', media: [] },
        { link: 'https://example.com', media: [] },
        { text: '', link: 'https://example.com', media: [] },
        { text: 'Read more', link: 'https://example.com', media: [] },
        { media: [{ assetId: 'photo' }] },
        { text: 'Caption', media: [{ assetId: 'photo', accessibilityText: 'A mountain' }] },
        { text: 'Caption', link: '', media: [{ assetId: 'photo' }] },
    ])
        expect(profile.validate(content).ok).toBe(true)
    expect(
        facebookChannelProfile.fieldBindings.some(binding => binding.semantic === 'headline')
    ).toBe(false)
    expect(facebookChannelProfile.capabilities.mediaFields[0]).toMatchObject({
        families: ['image'],
        mimeTypes: ['image/jpeg', 'image/png'],
        maxItems: 1,
        maxBytesPerItem: FACEBOOK_MAX_PHOTO_BYTES,
    })
    // No unsupported native maximum is advertised as a platform fact.
    expect(facebookChannelProfile.capabilities.textFields).toEqual([
        { bindingId: 'text', acceptedSourceFormats: ['plain_text'], maxLength: null },
    ])
})

test('structural and native Facebook content errors remain field-addressable', () => {
    const profile = compiledProfile()
    for (const content of [
        { media: [] },
        { text: ' ', link: '', media: [] },
        { link: 'javascript:alert(1)', media: [] },
        { link: 'https://user:secret@example.com', media: [] },
        { link: 'https://example.com', media: [{ assetId: 'photo' }] },
        { text: 42, media: [] },
        { text: 'Hello', link: 42, media: [] },
        { text: 'Hello', media: [{ assetId: 'one' }, { assetId: 'two' }] },
        { text: 'Hello', media: [{ assetId: '' }] },
        { text: 'Hello', media: [], title: 'Unexpected headline' },
    ])
        expect(profile.validate(content).ok).toBe(false)
    expect(profile.validate({ media: [] }).issues).toContainEqual(
        expect.objectContaining({ path: '/text', code: 'facebook.content_required' })
    )
    expect(
        profile.validate({ link: 'https://example.com', media: [{ assetId: 'one' }] }).issues
    ).toContainEqual(
        expect.objectContaining({ path: '/link', code: 'facebook.link_photo_combination' })
    )
})

test('source adaptation preserves exact body/media and explicit target-only link state', () => {
    const source = {
        body: {
            text: 'A post with https://example.com inside its text',
            format: 'plain_text' as const,
        },
        media: [{ assetId: 'photo', accessibilityText: 'A mountain' }],
    }
    expect(adaptSourceContentToProfile(source, facebookChannelProfile)).toEqual({
        text: source.body.text,
        media: source.media,
    })
    const linked = applySourceContentToTarget(
        { body: { text: 'Updated copy', format: 'plain_text' }, media: [] },
        facebookChannelProfile,
        { text: 'Old copy', media: [], link: 'https://example.com' }
    )
    expect(linked).toEqual({ text: 'Updated copy', media: [], link: 'https://example.com' })
    expect(
        compiledProfile().validate(
            adaptSourceContentToProfile({ media: [{ assetId: 'photo' }] }, facebookChannelProfile)
        ).ok
    ).toBe(true)
})

test('native rules do not reinterpret manual or unsupported execution revisions', () => {
    for (const execution of [
        { kind: 'manual' as const },
        { kind: 'built_in' as const, contractId: 'facebook', revision: 'future' },
        { kind: 'built_in' as const, contractId: 'other', revision: 'page-post-v1' },
    ])
        expect(
            facebookChannelProfileValidationAdapter.validate(
                { ...facebookChannelProfile, execution },
                { media: [] }
            )
        ).toEqual([])
})
