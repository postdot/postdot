import * as m from '@/paraglide/messages.js'

export function formatMediaRetentionDuration(durationMs: number): string {
    let remainingSeconds = Math.max(0, Math.ceil(durationMs / 1_000))
    const units = [
        { seconds: 24 * 60 * 60, format: m.media_retention_days },
        { seconds: 60 * 60, format: m.media_retention_hours },
        { seconds: 60, format: m.media_retention_minutes },
        { seconds: 1, format: m.media_retention_seconds },
    ]
    const parts: string[] = []

    for (const unit of units) {
        const count = Math.floor(remainingSeconds / unit.seconds)
        if (count === 0) continue
        parts.push(unit.format({ count }))
        remainingSeconds %= unit.seconds
    }

    return parts.join(' ') || m.media_retention_seconds({ count: 0 })
}

export function formatMediaDeletionDeadline(timestamp: number, locale: string): string {
    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(timestamp))
}
