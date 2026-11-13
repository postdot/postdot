import { expect, test } from 'bun:test'

import { createClientIpResolver, InvalidForwardedAddress, parseTrustedProxies } from './client-ip'

test('requires explicit bounded proxy addresses and rejects ambiguous configuration', () => {
    expect(parseTrustedProxies(undefined)).toEqual([])
    expect(parseTrustedProxies(' 127.0.0.1/32, ::1/128,127.0.0.1/32 ')).toEqual([
        '127.0.0.1/32',
        '::1/128',
    ])
    for (const value of [
        '*',
        'example.com',
        '127.0.0.1,',
        '127.0.0.1:80',
        '10.0.0.0/0',
        '::/0',
        '10.0.0.0/33',
        '::1/129',
        '::1/01',
        'fe80::1%eth0',
        '1.2.3.4/24/1',
        Array(65).fill('127.0.0.1').join(','),
    ]) {
        expect(() => parseTrustedProxies(value)).toThrow('POSTDOT_TRUSTED_PROXIES')
    }
})

test('uses the socket for direct peers and never establishes trust from a forwarded header', () => {
    const direct = createClientIpResolver([])
    expect(direct('203.0.113.10', '198.51.100.99')).toBe('203.0.113.10')
    expect(direct('127.0.0.1', '198.51.100.99')).toBe('127.0.0.1')
    expect(direct(null, '198.51.100.99')).toBeNull()
    const proxied = createClientIpResolver(['10.0.0.0/24'])
    expect(proxied('203.0.113.10', '198.51.100.99,10.0.0.1')).toBe('203.0.113.10')
})

test('walks trusted proxies from the connected peer and stops before a forged prefix', () => {
    const resolve = createClientIpResolver(['10.0.0.0/24', '2001:db8:1::/64'])
    expect(resolve('10.0.0.2', '198.51.100.200, 203.0.113.10,10.0.0.1')).toBe('203.0.113.10')
    expect(resolve('10.0.0.2', 'garbage,203.0.113.10')).toBe('203.0.113.10')
    expect(resolve('2001:db8:1::2', '2001:db8:2::1234,2001:db8:1::1')).toBe('2001:db8:2::1234')
    expect(resolve('10.0.0.2', null)).toBe('10.0.0.2')
    expect(resolve('10.0.0.2', '10.0.0.1')).toBe('10.0.0.2')
})

test('recognizes IPv4-mapped peers without trusting the whole loopback network', () => {
    const resolve = createClientIpResolver(['127.0.0.1/32'])
    for (const peer of ['127.0.0.1', '::ffff:127.0.0.1', '::ffff:7f00:1'])
        expect(resolve(peer, '203.0.113.10')).toBe('203.0.113.10')
    expect(resolve('127.0.0.2', '203.0.113.10')).toBe('127.0.0.2')
})

test('rejects malformed or excessive trusted chains instead of changing the quota identity', () => {
    const resolve = createClientIpResolver(['127.0.0.1'])
    for (const forwarded of [
        '',
        'unknown',
        '203.0.113.10,',
        '[2001:db8::1]',
        '203.0.113.10:80',
        'fe80::1%eth0',
        Array(33).fill('127.0.0.1').join(','),
        'a'.repeat(4097),
    ])
        expect(() => resolve('127.0.0.1', forwarded)).toThrow(InvalidForwardedAddress)
})
