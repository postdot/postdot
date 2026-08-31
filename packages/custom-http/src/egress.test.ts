import { describe, expect, test } from 'bun:test'

import {
    createCustomHttpEndpointAuthorizer,
    CustomHttpPolicyError,
    normalizeCustomHttpEndpoint,
} from './egress'

const publicResolver = async () => [{ address: '8.8.8.8', family: 4 as const }]

describe('custom HTTP egress policy', () => {
    test('normalizes origin-only HTTPS endpoints', () => {
        expect(normalizeCustomHttpEndpoint('https://Example.test')).toEqual({
            url: new URL('https://Example.test/'),
            hostname: 'example.test',
            port: 443,
            scheme: 'https',
        })
    })

    test('rejects credentials and endpoint paths', () => {
        expect(() => normalizeCustomHttpEndpoint('https://user:pass@example.test')).toThrow(
            'must not contain credentials'
        )
        expect(() => normalizeCustomHttpEndpoint('https://example.test/publish')).toThrow(
            'must contain only an origin'
        )
    })

    test('allows public HTTPS and rejects public HTTP', async () => {
        const authorizer = createCustomHttpEndpointAuthorizer({ resolveHostname: publicResolver })

        await expect(authorizer.authorize('https://example.test')).resolves.toMatchObject({
            hostname: 'example.test',
            scheme: 'https',
            selectedAddress: { address: '8.8.8.8', family: 4 },
        })
        await expect(authorizer.authorize('http://example.test')).rejects.toBeInstanceOf(
            CustomHttpPolicyError
        )
    })

    test('denies private addresses until the operator explicitly allows them', async () => {
        const resolver = async () => [{ address: '127.0.0.1', family: 4 as const }]
        const denied = createCustomHttpEndpointAuthorizer({ resolveHostname: resolver })
        await expect(denied.authorize('http://localhost')).rejects.toBeInstanceOf(
            CustomHttpPolicyError
        )

        const allowed = createCustomHttpEndpointAuthorizer({
            resolveHostname: resolver,
            privateDestinations: [
                { kind: 'cidr', cidr: '127.0.0.0/8', port: 80, schemes: ['http'] },
            ],
        })
        await expect(allowed.authorize('http://localhost')).resolves.toMatchObject({
            selectedAddress: { address: '127.0.0.1', family: 4 },
        })
    })

    test('rejects mixed public and private DNS answers without a hostname rule', async () => {
        const authorizer = createCustomHttpEndpointAuthorizer({
            resolveHostname: async () => [
                { address: '8.8.8.8', family: 4 },
                { address: '10.0.0.5', family: 4 },
            ],
            privateDestinations: [
                { kind: 'cidr', cidr: '10.0.0.0/8', port: 443, schemes: ['https'] },
            ],
        })

        await expect(authorizer.authorize('https://mixed.example.test')).rejects.toBeInstanceOf(
            CustomHttpPolicyError
        )
    })

    test('classifies IPv4-mapped IPv6 loopback as private', async () => {
        const authorizer = createCustomHttpEndpointAuthorizer({
            resolveHostname: async () => [{ address: '::ffff:127.0.0.1', family: 6 }],
            privateDestinations: [
                { kind: 'cidr', cidr: '127.0.0.0/8', port: 443, schemes: ['https'] },
            ],
        })

        await expect(authorizer.authorize('https://mapped.example.test')).rejects.toBeInstanceOf(
            CustomHttpPolicyError
        )
    })
})
