import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import type {
    CustomHttpEgressOptions,
    PrivateDestinationRule,
    ResolvedNetworkAddress,
} from './contract'

export class CustomHttpPolicyError extends Error {
    readonly code = 'network_policy_denied' as const
}

export class CustomHttpResolutionError extends Error {
    readonly code = 'network_resolution_failed' as const
    readonly cause: unknown

    constructor(message: string, cause?: unknown) {
        super(message)
        this.name = 'CustomHttpResolutionError'
        this.cause = cause
    }
}

export interface NormalizedCustomHttpEndpoint {
    readonly url: URL
    readonly hostname: string
    readonly port: number
    readonly scheme: 'http' | 'https'
}

export interface AuthorizedCustomHttpEndpoint extends NormalizedCustomHttpEndpoint {
    readonly addresses: readonly ResolvedNetworkAddress[]
    readonly selectedAddress: ResolvedNetworkAddress
}

export function normalizeCustomHttpEndpoint(value: string): NormalizedCustomHttpEndpoint {
    if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
        throw new TypeError('Custom HTTP endpoint must be a non-blank URL')
    }

    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw new TypeError('Custom HTTP endpoint is not a valid URL')
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new TypeError('Custom HTTP endpoint must use HTTP or HTTPS')
    }
    if (url.username.length > 0 || url.password.length > 0) {
        throw new TypeError('Custom HTTP endpoint must not contain credentials')
    }
    if (url.pathname !== '/' || url.search.length > 0 || url.hash.length > 0) {
        throw new TypeError('Custom HTTP endpoint must contain only an origin')
    }

    const hostname = stripIpv6Brackets(url.hostname).toLowerCase()
    if (hostname.length === 0) throw new TypeError('Custom HTTP endpoint hostname is blank')

    const defaultPort = url.protocol === 'https:' ? 443 : 80
    const port = url.port.length === 0 ? defaultPort : Number(url.port)
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        throw new TypeError('Custom HTTP endpoint port is invalid')
    }

    return {
        url,
        hostname,
        port,
        scheme: url.protocol === 'https:' ? 'https' : 'http',
    }
}

export function createCustomHttpEndpointAuthorizer(options: CustomHttpEgressOptions = {}) {
    const privateDestinations = options.privateDestinations ?? []
    const resolveHostname = options.resolveHostname ?? defaultResolveHostname

    return {
        async authorize(value: string): Promise<AuthorizedCustomHttpEndpoint> {
            const endpoint = normalizeCustomHttpEndpoint(value)
            let addresses: readonly ResolvedNetworkAddress[]
            try {
                addresses = await resolveHostname(endpoint.hostname)
            } catch (error) {
                if (error instanceof CustomHttpResolutionError) throw error
                throw new CustomHttpResolutionError(
                    `Could not resolve custom HTTP endpoint ${endpoint.hostname}`,
                    error
                )
            }

            if (
                addresses.length === 0 ||
                addresses.some(address => !isValidResolvedAddress(address))
            ) {
                throw new CustomHttpResolutionError(
                    `Custom HTTP endpoint ${endpoint.hostname} did not resolve to a valid address`
                )
            }

            const classifications = addresses.map(address => classifyAddress(address.address))
            if (classifications.some(classification => classification === 'metadata')) {
                throw new CustomHttpPolicyError(
                    'Custom HTTP delivery cannot target infrastructure metadata endpoints'
                )
            }

            const hasRestrictedAddress = classifications.some(
                classification => classification !== 'public'
            )
            const hasPublicAddress = classifications.some(
                classification => classification === 'public'
            )
            const hostnameRuleMatches = privateDestinations.some(
                rule =>
                    rule.kind === 'hostname' &&
                    normalizeRuleHostname(rule.hostname) === endpoint.hostname &&
                    rule.port === endpoint.port &&
                    rule.schemes.includes(endpoint.scheme)
            )

            if (hasRestrictedAddress) {
                const restrictedAddressesAllowed = addresses.every((address, index) => {
                    const classification = classifications[index]
                    if (classification === 'public') return hostnameRuleMatches
                    return matchesPrivateRule(privateDestinations, endpoint, address)
                })

                if (!restrictedAddressesAllowed || (hasPublicAddress && !hostnameRuleMatches)) {
                    throw new CustomHttpPolicyError(
                        `Custom HTTP endpoint ${endpoint.hostname}:${endpoint.port} is outside the operator private-destination policy`
                    )
                }
            } else if (endpoint.scheme === 'http') {
                throw new CustomHttpPolicyError('Public custom HTTP delivery must use HTTPS')
            }

            return {
                ...endpoint,
                addresses,
                selectedAddress: addresses[0]!,
            }
        },
    }
}

export function parsePrivateDestinationRules(
    value: string | undefined,
    variableName = 'HERALD_CUSTOM_HTTP_PRIVATE_DESTINATIONS'
): readonly PrivateDestinationRule[] {
    if (value === undefined || value.trim().length === 0) return []

    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new TypeError(`${variableName} must be valid JSON`)
    }
    if (!Array.isArray(parsed)) {
        throw new TypeError(`${variableName} must be a JSON array`)
    }

    return parsed.map((candidate, index) => parsePrivateDestinationRule(candidate, index))
}

function parsePrivateDestinationRule(value: unknown, index: number): PrivateDestinationRule {
    if (!isRecord(value)) {
        throw new TypeError(`Private destination rule ${index} must be an object`)
    }
    const kind = value.kind
    const port = value.port
    const schemes = value.schemes
    if (
        (kind !== 'hostname' && kind !== 'cidr') ||
        typeof port !== 'number' ||
        !Number.isSafeInteger(port) ||
        port < 1 ||
        port > 65_535 ||
        !Array.isArray(schemes) ||
        schemes.length === 0 ||
        schemes.some(scheme => scheme !== 'http' && scheme !== 'https')
    ) {
        throw new TypeError(`Private destination rule ${index} is invalid`)
    }

    if (kind === 'hostname') {
        const hostname = normalizeRuleHostname(String(value.hostname ?? ''))
        if (hostname.length === 0 || isIP(hostname) !== 0) {
            throw new TypeError(`Private hostname rule ${index} has an invalid hostname`)
        }
        return { kind, hostname, port, schemes: [...new Set(schemes)] }
    }

    const cidr = String(value.cidr ?? '')
    parseCidr(cidr)
    return { kind, cidr, port, schemes: [...new Set(schemes)] }
}

function matchesPrivateRule(
    rules: readonly PrivateDestinationRule[],
    endpoint: NormalizedCustomHttpEndpoint,
    address: ResolvedNetworkAddress
): boolean {
    return rules.some(rule => {
        if (rule.port !== endpoint.port || !rule.schemes.includes(endpoint.scheme)) return false
        if (rule.kind === 'hostname') {
            return normalizeRuleHostname(rule.hostname) === endpoint.hostname
        }
        return addressInCidr(address.address, rule.cidr)
    })
}

function defaultResolveHostname(hostname: string): Promise<readonly ResolvedNetworkAddress[]> {
    if (isIP(hostname) !== 0) {
        return Promise.resolve([
            {
                address: hostname,
                family: isIP(hostname) as 4 | 6,
            },
        ])
    }

    return dnsLookup(hostname, { all: true, verbatim: true }).then(addresses =>
        addresses.map(address => ({
            address: address.address,
            family: address.family as 4 | 6,
        }))
    )
}

function isValidResolvedAddress(value: ResolvedNetworkAddress): boolean {
    return (value.family === 4 || value.family === 6) && isIP(value.address) === value.family
}

type AddressClassification = 'public' | 'restricted' | 'metadata'

function classifyAddress(value: string): AddressClassification {
    const family = isIP(value)
    if (family === 0) return 'restricted'

    const normalized = normalizeIp(value, family as 4 | 6)
    if (family === 4) return classifyIpv4(normalized)

    const mappedIpv4 = ipv4FromMappedIpv6(normalized)
    if (mappedIpv4 !== null) return classifyIpv4(mappedIpv4)
    if (isIpv6Metadata(normalized)) return 'metadata'
    if (
        isIpv6InPrefix(normalized, '::', 128) ||
        isIpv6InPrefix(normalized, '::1', 128) ||
        isIpv6InPrefix(normalized, 'fc00::', 7) ||
        isIpv6InPrefix(normalized, 'fe80::', 10) ||
        isIpv6InPrefix(normalized, 'ff00::', 8) ||
        isIpv6InPrefix(normalized, '2001:db8::', 32) ||
        isIpv6InPrefix(normalized, '2001::', 32) ||
        isIpv6InPrefix(normalized, '2001:2::', 48) ||
        isIpv6InPrefix(normalized, '2001:10::', 28)
    ) {
        return 'restricted'
    }
    return 'public'
}

function classifyIpv4(value: string): AddressClassification {
    const octets = value.split('.').map(Number)
    if (
        octets.length !== 4 ||
        octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)
    ) {
        return 'restricted'
    }
    const [first, second, third, fourth] = octets as [number, number, number, number]
    if (
        (first === 169 &&
            second === 254 &&
            (third === 169 || third === 170) &&
            (fourth === 254 || fourth === 2)) ||
        (first === 100 && second === 100 && third === 100 && fourth === 200)
    ) {
        return 'metadata'
    }
    if (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 192 && second === 0 && third === 0) ||
        (first === 192 && second === 0 && third === 2) ||
        (first === 192 && second === 88 && third === 99) ||
        (first === 198 && second === 18) ||
        (first === 198 && second === 19) ||
        (first === 198 && second === 51 && third === 100) ||
        (first === 203 && second === 0 && third === 113) ||
        first >= 224 ||
        (first === 255 && second === 255 && third === 255 && fourth === 255)
    ) {
        return 'restricted'
    }
    return 'public'
}

function isIpv6Metadata(value: string): boolean {
    return (
        isIpv6InPrefix(value, 'fd00:ec2::254', 128) || isIpv6InPrefix(value, 'fd00:ec2::253', 128)
    )
}

function normalizeRuleHostname(value: string): string {
    return stripIpv6Brackets(value.trim()).toLowerCase()
}

function stripIpv6Brackets(value: string): string {
    return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}

interface ParsedCidr {
    readonly family: 4 | 6
    readonly address: string
    readonly prefix: number
}

function parseCidr(value: string): ParsedCidr {
    const separator = value.lastIndexOf('/')
    if (separator <= 0 || separator === value.length - 1) {
        throw new TypeError(`Invalid private destination CIDR: ${value}`)
    }
    const address = value.slice(0, separator)
    const prefix = Number(value.slice(separator + 1))
    const family = isIP(address)
    if (
        (family !== 4 && family !== 6) ||
        !Number.isSafeInteger(prefix) ||
        prefix < 0 ||
        prefix > (family === 4 ? 32 : 128)
    ) {
        throw new TypeError(`Invalid private destination CIDR: ${value}`)
    }
    return { family: family as 4 | 6, address, prefix }
}

function addressInCidr(address: string, cidr: string): boolean {
    const range = parseCidr(cidr)
    const family = isIP(address)
    if (family !== range.family) return false
    const normalizedAddress = normalizeIp(address, family as 4 | 6)
    const normalizedNetwork = normalizeIp(range.address, range.family)
    if (range.family === 4) {
        const addressNumber = ipv4ToNumber(normalizedAddress)
        const networkNumber = ipv4ToNumber(normalizedNetwork)
        const mask = range.prefix === 0 ? 0 : (0xffffffff << (32 - range.prefix)) >>> 0
        return (addressNumber & mask) === (networkNumber & mask)
    }

    const addressWords = ipv6Words(normalizedAddress)
    const networkWords = ipv6Words(normalizedNetwork)
    let remaining = range.prefix
    for (let index = 0; index < 8; index += 1) {
        if (remaining <= 0) return true
        const bits = Math.min(remaining, 16)
        const mask = bits === 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff
        if ((addressWords[index]! & mask) !== (networkWords[index]! & mask)) return false
        remaining -= bits
    }
    return true
}

function normalizeIp(value: string, family: 4 | 6): string {
    if (family === 4) return value
    return ipv6Words(value)
        .map(word => word.toString(16).padStart(4, '0'))
        .join(':')
}

function ipv4ToNumber(value: string): number {
    return value.split('.').reduce((result, octet) => result * 256 + Number(octet), 0) >>> 0
}

function ipv4FromMappedIpv6(value: string): string | null {
    if (!isIpv6InPrefix(value, '::ffff:0:0', 96)) return null
    const words = ipv6Words(value)
    return [words[6]! >> 8, words[6]! & 0xff, words[7]! >> 8, words[7]! & 0xff].join('.')
}

function isIpv6InPrefix(value: string, prefixValue: string, prefix: number): boolean {
    const valueWords = ipv6Words(value)
    const prefixWords = ipv6Words(prefixValue)
    let remaining = prefix
    for (let index = 0; index < 8; index += 1) {
        if (remaining <= 0) return true
        const bits = Math.min(remaining, 16)
        const mask = bits === 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff
        if ((valueWords[index]! & mask) !== (prefixWords[index]! & mask)) return false
        remaining -= bits
    }
    return true
}

function ipv6Words(value: string): number[] {
    const normalized = value.toLowerCase()
    const [leftRaw, rightRaw, ...extra] = normalized.split('::')
    if (extra.length > 0) throw new TypeError(`Invalid IPv6 address: ${value}`)

    const parseSide = (side: string): number[] => {
        if (side.length === 0) return []
        return side.split(':').flatMap((part, index, parts) => {
            if (part.includes('.')) {
                if (index !== parts.length - 1)
                    throw new TypeError(`Invalid IPv6 address: ${value}`)
                const octets = part.split('.').map(Number)
                if (
                    octets.length !== 4 ||
                    octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)
                ) {
                    throw new TypeError(`Invalid IPv6 address: ${value}`)
                }
                return [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!]
            }
            if (!/^[0-9a-f]{1,4}$/.test(part)) throw new TypeError(`Invalid IPv6 address: ${value}`)
            return [Number.parseInt(part, 16)]
        })
    }

    const left = parseSide(leftRaw ?? '')
    const right = parseSide(rightRaw ?? '')
    const missing = 8 - left.length - right.length
    if (missing < 0 || (rightRaw === undefined && missing !== 0)) {
        throw new TypeError(`Invalid IPv6 address: ${value}`)
    }
    return [...left, ...Array.from({ length: missing }, () => 0), ...right]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
