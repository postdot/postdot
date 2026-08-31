import { describe, expect, it } from 'bun:test'

import { createMediaPublicDelivery, mediaPublicDeliveryLimits } from './public-delivery'

const baseURL = 'https://herald.example.test'
const signingSecret = 'media-public-delivery-secret-with-at-least-32-bytes'
const now = 1_800_000_000_000

describe('media public delivery authority', () => {
    it('creates and verifies a short-lived representation capability', () => {
        const delivery = createMediaPublicDelivery({
            baseURL,
            signingSecret,
            lifetimeMs: 60_000,
            now: () => now,
        })

        const url = delivery.createUrl({
            projectId: 'project-1',
            assetId: 'asset-1',
            representationId: 'representation-1',
        })

        expect(new URL(url).origin).toBe(baseURL)
        expect(new URL(url).pathname).toStartWith('/api/media/public/')
        expect(
            delivery.resolve(new URL(url).pathname.split('/').at(-1) ?? '', now + 59_000)
        ).toEqual({
            projectId: 'project-1',
            assetId: 'asset-1',
            representationId: 'representation-1',
            expiresAt: now + 60_000,
        })
    })

    it('rejects tampered, non-canonical, expired, malformed, and differently signed capabilities', () => {
        const delivery = createMediaPublicDelivery({
            baseURL,
            signingSecret,
            lifetimeMs: 60_000,
            now: () => now,
        })
        const token = new URL(
            delivery.createUrl({
                projectId: 'project-1',
                assetId: 'asset-1',
                representationId: 'representation-1',
            })
        ).pathname
            .split('/')
            .at(-1)!

        const [payload, signature] = token.split('.')
        const tampered = `${payload}.${signature!.replace(/.$/, signature!.endsWith('a') ? 'b' : 'a')}`

        expect(delivery.resolve(tampered, now)).toBeNull()
        expect(delivery.resolve(token, now + 60_000)).toBeNull()
        expect(delivery.resolve('not-a-token', now)).toBeNull()
        expect(
            createMediaPublicDelivery({
                baseURL,
                signingSecret: 'another-media-public-delivery-secret-with-32-bytes',
                now: () => now,
            }).resolve(token, now)
        ).toBeNull()
    })

    it('keeps the URL origin and token inputs bounded', () => {
        expect(() =>
            createMediaPublicDelivery({
                baseURL: 'http://user:password@herald.example.test',
                signingSecret,
            })
        ).toThrow()
        expect(() =>
            createMediaPublicDelivery({
                baseURL,
                signingSecret: 'short-secret',
            })
        ).toThrow()
        expect(() =>
            createMediaPublicDelivery({
                baseURL,
                signingSecret,
                lifetimeMs: mediaPublicDeliveryLimits.maximumLifetimeMs + 1,
            })
        ).toThrow()
        expect(() =>
            createMediaPublicDelivery({ baseURL, signingSecret }).createUrl({
                projectId: 'project\u0000',
                assetId: 'asset-1',
                representationId: 'representation-1',
            })
        ).toThrow()
    })
})
