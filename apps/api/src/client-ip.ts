import { BlockList, isIP } from 'node:net'

const maximumProxyEntries = 64
const maximumForwardedLength = 4096
const maximumForwardedHops = 32

function family(address: string): 'ipv4' | 'ipv6' | null {
    if (address.includes('%')) return null
    const version = isIP(address)
    return version === 4 ? 'ipv4' : version === 6 ? 'ipv6' : null
}

export function parseTrustedProxies(raw: string | undefined): readonly string[] {
    const entries = raw?.trim() ? raw.split(',').map(value => value.trim()) : []
    createClientIpResolver(entries)
    return [...new Set(entries)]
}

/** Only the connected peer can establish trust in a forwarded chain. */
export function createClientIpResolver(entries: readonly string[]) {
    if (entries.length > maximumProxyEntries)
        throw new Error('POSTDOT_TRUSTED_PROXIES has too many entries')
    const trusted = new BlockList()
    for (const entry of entries) {
        const [address = '', prefix, ...extra] = entry.split('/')
        const version = family(address)
        if (
            !version ||
            extra.length ||
            (prefix !== undefined &&
                (!/^(0|[1-9]\d*)$/.test(prefix) ||
                    Number(prefix) < 1 ||
                    Number(prefix) > (version === 'ipv4' ? 32 : 128)))
        ) {
            throw new Error(
                'POSTDOT_TRUSTED_PROXIES must contain IP addresses or bounded CIDR ranges'
            )
        }
        if (prefix === undefined) trusted.addAddress(address, version)
        else trusted.addSubnet(address, Number(prefix), version)
    }
    const isTrusted = (address: string) => {
        const version = family(address)
        return version !== null && trusted.check(address, version)
    }
    return (peerAddress: string | null, forwardedFor: string | null): string | null => {
        if (!peerAddress || !family(peerAddress)) return null
        if (!isTrusted(peerAddress) || forwardedFor === null) return peerAddress
        if (forwardedFor.length > maximumForwardedLength) throw new InvalidForwardedAddress()
        const chain = forwardedFor.split(',')
        if (chain.length > maximumForwardedHops) throw new InvalidForwardedAddress()
        let address = peerAddress
        for (let index = chain.length - 1; index >= 0; index--) {
            if (!isTrusted(address)) return address
            const next = chain[index]!.trim()
            if (!family(next)) throw new InvalidForwardedAddress()
            address = next
        }
        // A chain made only of trusted proxies establishes no separate client.
        return isTrusted(address) ? peerAddress : address
    }
}

export class InvalidForwardedAddress extends Error {
    constructor() {
        super('Invalid forwarded client address')
    }
}
