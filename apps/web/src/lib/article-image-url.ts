/** Reject obvious private addresses; this cannot certify public reachability or permanence. */
export function articleImageUrl(value: string): string | null {
    try {
        const url = new URL(value.trim())
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
        const host = url.hostname.toLowerCase().replace(/\.$/, '')
        if (
            host === 'localhost' ||
            host.endsWith('.localhost') ||
            host.endsWith('.local') ||
            host === '[::]' ||
            host === '[::1]' ||
            /^\[(?:fc|fd|fe[89ab]|::ffff:)/.test(host) ||
            (!host.includes('.') && !host.startsWith('['))
        )
            return null
        if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
            const [first, second] = host.split('.').map(Number)
            if (
                first === 0 ||
                first === 10 ||
                first === 127 ||
                (first === 169 && second === 254) ||
                (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
                (first === 192 && second === 168) ||
                (first === 100 && second !== undefined && second >= 64 && second <= 127) ||
                (first !== undefined && first >= 224)
            )
                return null
        }
        if (typeof window !== 'undefined' && url.origin === window.location.origin) return null
        return url.href
    } catch {
        return null
    }
}
