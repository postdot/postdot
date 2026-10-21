import { expect, test } from 'bun:test'

import {
    adaptSourceContentToProfile,
    applySourceContentToTarget,
    ChannelProfileCompiler,
} from '@postdot/core'

import {
    INSTAGRAM_EXECUTION_REVISION,
    instagramChannelProfile,
    instagramChannelProfileValidationAdapter,
} from './profile'
import {
    INSTAGRAM_MAX_ACCESSIBILITY_TEXT_LENGTH,
    INSTAGRAM_MAX_CAPTION_LENGTH,
    INSTAGRAM_MAX_IMAGE_BYTES,
} from './publisher'

function compiledProfile() {
    const result = new ChannelProfileCompiler({
        validationAdapters: [instagramChannelProfileValidationAdapter],
    }).compile(instagramChannelProfile)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Instagram profile did not compile')
    return result.value
}

test('the Instagram profile accepts one image with an optional caption and accessibility text', () => {
    const profile = compiledProfile()
    for (const content of [
        { media: [{ assetId: 'photo' }] },
        { caption: 'Announcement', media: [{ assetId: 'photo' }] },
        { caption: '', media: [{ assetId: 'photo' }] },
        { media: [{ assetId: 'photo', accessibilityText: 'A mountain' }] },
        { caption: 'Caption', media: [{ assetId: 'photo', accessibilityText: 'A mountain' }] },
    ])
        expect(profile.validate(content).ok).toBe(true)
    expect(
        instagramChannelProfile.fieldBindings.some(binding => binding.semantic === 'headline')
    ).toBe(false)
    expect(instagramChannelProfile.execution).toEqual({
        kind: 'built_in',
        contractId: 'instagram',
        revision: INSTAGRAM_EXECUTION_REVISION,
    })
})

test('the Instagram capability describes one JPEG and a conservative byte envelope', () => {
    expect(instagramChannelProfile.capabilities.mediaFields[0]).toMatchObject({
        families: ['image'],
        mimeTypes: ['image/jpeg'],
        maxItems: 1,
        maxBytesPerItem: INSTAGRAM_MAX_IMAGE_BYTES,
        accessibilityTextRequired: false,
        publicUrlRequired: true,
    })
    expect(INSTAGRAM_MAX_IMAGE_BYTES).toBe(8_000_000)
    expect(instagramChannelProfile.capabilities.textFields).toEqual([
        {
            bindingId: 'caption',
            acceptedSourceFormats: ['plain_text'],
            maxLength: INSTAGRAM_MAX_CAPTION_LENGTH,
        },
    ])
    expect(INSTAGRAM_MAX_CAPTION_LENGTH).toBe(2200)
    expect(INSTAGRAM_MAX_ACCESSIBILITY_TEXT_LENGTH).toBe(1000)
})

test('the profile carries an asset reference, never a raw image URL or MIME type', () => {
    const schema = instagramChannelProfile.contentSchema as unknown as {
        readonly properties: {
            readonly media: {
                readonly items: { readonly properties: Readonly<Record<string, unknown>> }
            }
        }
    }
    expect(Object.keys(schema.properties)).toEqual(['caption', 'media'])
    expect(Object.keys(schema.properties.media.items.properties)).toEqual([
        'assetId',
        'accessibilityText',
    ])
})

test('structural Instagram content errors remain field-addressable', () => {
    const profile = compiledProfile()
    for (const content of [
        { media: [] },
        { caption: 'Announcement' },
        { caption: 'Announcement', media: [{ assetId: 'one' }, { assetId: 'two' }] },
        { caption: 42, media: [{ assetId: 'one' }] },
        { caption: 'Announcement', media: [{ assetId: '' }] },
        { caption: 'Announcement', media: [{ assetId: 'one', unexpected: true }] },
        { caption: 'Announcement', media: [{ assetId: 'one' }], title: 'Unexpected headline' },
    ])
        expect(profile.validate(content).ok).toBe(false)
    expect(profile.validate({ media: [] }).issues).toContainEqual(
        expect.objectContaining({ path: '/media', code: 'schema.minItems' })
    )
    expect(
        profile.validate({
            caption: 'Announcement',
            media: [{ assetId: 'one' }, { assetId: 'two' }],
        }).issues
    ).toContainEqual(expect.objectContaining({ path: '/media', code: 'schema.maxItems' }))
})

test('the documented caption and accessibility text ceilings reject oversized content', () => {
    const profile = compiledProfile()
    expect(
        profile.validate({
            caption: 'a'.repeat(INSTAGRAM_MAX_CAPTION_LENGTH),
            media: [{ assetId: 'photo' }],
        }).ok
    ).toBe(true)
    expect(
        profile.validate({
            caption: 'a'.repeat(INSTAGRAM_MAX_CAPTION_LENGTH + 1),
            media: [{ assetId: 'photo' }],
        }).ok
    ).toBe(false)
    expect(
        profile.validate({
            media: [
                {
                    assetId: 'photo',
                    accessibilityText: 'b'.repeat(INSTAGRAM_MAX_ACCESSIBILITY_TEXT_LENGTH),
                },
            ],
        }).ok
    ).toBe(true)
    expect(
        profile.validate({
            media: [
                {
                    assetId: 'photo',
                    accessibilityText: 'b'.repeat(INSTAGRAM_MAX_ACCESSIBILITY_TEXT_LENGTH + 1),
                },
            ],
        }).ok
    ).toBe(false)
})

test('a blank accessibility text is a native Instagram rule, not a structural error', () => {
    const profile = compiledProfile()
    const result = profile.validate({ media: [{ assetId: 'photo', accessibilityText: '   ' }] })
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
        expect.objectContaining({
            path: '/media/0/accessibilityText',
            code: 'instagram.accessibility_text_blank',
        })
    )
})

test('source adaptation preserves the caption and the ordered image', () => {
    const source = {
        body: {
            text: 'A post with https://example.com inside its caption',
            format: 'plain_text' as const,
        },
        media: [{ assetId: 'photo', accessibilityText: 'A mountain' }],
    }
    expect(adaptSourceContentToProfile(source, instagramChannelProfile)).toEqual({
        caption: source.body.text,
        media: source.media,
    })
    expect(
        applySourceContentToTarget(
            { body: { text: 'Updated copy', format: 'plain_text' }, media: [] },
            instagramChannelProfile,
            { caption: 'Old copy', media: [{ assetId: 'photo' }] }
        )
    ).toEqual({ caption: 'Updated copy', media: [] })
    expect(
        compiledProfile().validate(
            adaptSourceContentToProfile({ media: [{ assetId: 'photo' }] }, instagramChannelProfile)
        ).ok
    ).toBe(true)
})

test('native rules do not reinterpret manual or unsupported execution revisions', () => {
    for (const execution of [
        { kind: 'manual' as const },
        { kind: 'built_in' as const, contractId: 'instagram', revision: 'future' },
        { kind: 'built_in' as const, contractId: 'other', revision: INSTAGRAM_EXECUTION_REVISION },
    ])
        expect(
            instagramChannelProfileValidationAdapter.validate(
                { ...instagramChannelProfile, execution },
                { media: [{ assetId: 'photo', accessibilityText: '   ' }] }
            )
        ).toEqual([])
})
