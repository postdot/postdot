export function safeSameOrigin(value: string, origin: string | null): boolean {
    try {
        const url = new URL(value)
        return url.protocol === 'https:' && !url.username && !url.password && url.origin === origin
    } catch {
        return false
    }
}
