import { expect, test } from 'bun:test'

import { ChannelProfileCompiler } from '@postdot/core'

import {
    MASTODON_POLL_LIMITS,
    mastodonChannelProfileValidationAdapter,
    mastodonPollError,
} from './poll'
import {
    mastodonChannelProfile,
    mastodonImageChannelProfile,
    mastodonVideoChannelProfile,
} from './profile'
import { createMastodonPublisher } from './publisher'

const poll = { options: ['First', 'Second'], expiresIn: 86400, multiple: true, hideTotals: true }
test('versions poll support without changing historical profiles and validates native constraints', () => {
    const compiler = new ChannelProfileCompiler({
        validationAdapters: [mastodonChannelProfileValidationAdapter],
    })
    for (const [profile, supported] of [
        [mastodonImageChannelProfile, false],
        [mastodonVideoChannelProfile, false],
        [mastodonChannelProfile, true],
    ] as const) {
        const compiled = compiler.compile(profile)
        expect(compiled.ok).toBe(true)
        if (!compiled.ok) throw new Error('Poll profile compilation failed')
        expect(compiled.value.validate({ text: 'Choose', media: [] }).ok).toBe(true)
        expect(compiled.value.validate({ text: 'Choose', media: [], poll }).ok).toBe(supported)
    }
    expect(mastodonVideoChannelProfile.execution).toMatchObject({ revision: 'status-v2' })
    const current = compiler.compile(mastodonChannelProfile)
    if (!current.ok) throw new Error('Poll profile failed')
    for (const invalid of [
        { ...poll, options: ['Same', 'Same'] },
        { ...poll, options: [' ', 'Other'] },
        { ...poll, options: ['x'.repeat(51), 'Other'] },
        { ...poll, expiresIn: 0 },
    ])
        expect(current.value.validate({ text: 'Choose', media: [], poll: invalid }).ok).toBe(false)
    expect(
        current.value.validate({
            text: 'Choose',
            media: [{ assetId: 'image', accessibilityText: 'Image' }],
            poll,
        }).ok
    ).toBe(false)
    expect(
        current.value.validate({
            text: 'Choose',
            media: [],
            poll: { ...poll, options: ['😀'.repeat(50), 'Other'] },
        }).ok
    ).toBe(true)
})
test('reads advertised limits and encodes an actual poll with one status idempotency key', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const publisher = createMastodonPublisher({
        baseUrl: 'https://social.example',
        fetcher: async (url, init) => {
            requests.push({ url: String(url), init })
            return Response.json(
                String(url).endsWith('/instance')
                    ? {
                          configuration: {
                              polls: {
                                  max_options: 3,
                                  max_characters_per_option: 25,
                                  min_expiration: 600,
                                  max_expiration: 86400,
                              },
                          },
                      }
                    : {
                          id: '100',
                          url: 'https://social.example/@owner/100',
                          poll: { id: '10', options: poll.options.map(title => ({ title })) },
                      }
            )
        },
    })
    expect(await publisher.getPollLimits()).toEqual({
        kind: 'success',
        value: {
            maxOptions: 3,
            maxCharactersPerOption: 25,
            minExpiration: 600,
            maxExpiration: 86400,
        },
    })
    expect(new Headers(requests[0]!.init?.headers).has('authorization')).toBe(false)
    expect(
        await publisher.publishStatus({
            text: 'Choose',
            accessToken: 'synthetic-token',
            mediaIds: [],
            poll,
            idempotencyKey: 'publication:revision',
        })
    ).toMatchObject({ type: 'published', externalId: '100' })
    const request = requests[1]!
    const body = request.init!.body as URLSearchParams
    expect(body.getAll('poll[options][]')).toEqual(poll.options)
    expect(body.get('poll[expires_in]')).toBe('86400')
    expect(body.get('poll[multiple]')).toBe('true')
    expect(body.get('poll[hide_totals]')).toBe('true')
    expect(new Headers(request.init?.headers).get('idempotency-key')).toBe('publication:revision')
})
test('does not send invalid combinations and refuses missing configuration or poll acknowledgement', async () => {
    let calls = 0
    const publisher = createMastodonPublisher({
        baseUrl: 'https://social.example',
        fetcher: async () => {
            calls++
            return Response.json({ id: '100', url: null })
        },
    })
    expect(
        await publisher.publishStatus({
            text: 'Choose',
            accessToken: 'synthetic',
            mediaIds: ['image'],
            poll,
            idempotencyKey: 'key',
        })
    ).toMatchObject({ type: 'permanent_failure', effectOccurred: false })
    expect(calls).toBe(0)
    expect(await publisher.getPollLimits()).toMatchObject({
        kind: 'failure',
        outcome: { type: 'permanent_failure', effectOccurred: false },
    })
    expect(
        await publisher.publishStatus({
            text: 'Choose',
            accessToken: 'synthetic',
            mediaIds: [],
            poll,
            idempotencyKey: 'key',
        })
    ).toMatchObject({ type: 'ambiguous' })
    expect(
        mastodonPollError(poll, { ...MASTODON_POLL_LIMITS, maxCharactersPerOption: 3 })
    ).not.toBeNull()
})
