import * as m from '@/paraglide/messages.js'
export function telegramPollDuration(seconds: number): string {
    if (seconds === 86400) return m.poll_one_day()
    if (seconds === 3600) return m.poll_one_hour()
    if (seconds % 86400 === 0) return m.poll_days({ count: seconds / 86400 })
    if (seconds % 3600 === 0) return m.poll_hours({ count: seconds / 3600 })
    if (seconds % 60 === 0) return m.poll_minutes({ count: seconds / 60 })
    return m.poll_seconds({ count: seconds })
}
