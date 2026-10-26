import { expect, it } from 'bun:test'

import { destinationIdentity, sameDestination } from './channel-destination'

const account = {
    providerId: 'mastodon',
    externalAccountId: '42',
    externalAccountName: 'alice',
    destinationType: 'account',
    destinationId: '42',
    destinationName: 'alice',
}

it('distinguishes identical account IDs on different servers without treating a rename as a new destination', () => {
    const first = destinationIdentity({ ...account, endpointUrl: 'https://first.example.test' })
    const second = destinationIdentity({ ...account, endpointUrl: 'https://second.example.test' })
    const renamed = destinationIdentity({
        ...account,
        externalAccountName: 'New name',
        destinationName: 'New name',
        endpointUrl: 'https://first.example.test',
    })
    expect(sameDestination(first, second)).toBe(false)
    expect(sameDestination(first, renamed)).toBe(true)
})

it('exposes only a public endpoint origin and fingerprint, excluding URL secrets', () => {
    const identity = destinationIdentity({
        ...account,
        endpointUrl:
            'https://user:secret@example.test:8443/private-path?token=secret#private-fragment',
    })
    expect(identity.endpointOrigin).toBe('https://example.test:8443')
    expect(identity.endpointHash).toMatch(/^[a-f0-9]{64}$/)
    for (const secret of ['user', 'secret', 'private-path', 'token=', 'private-fragment'])
        expect(JSON.stringify(identity)).not.toContain(secret)
})
