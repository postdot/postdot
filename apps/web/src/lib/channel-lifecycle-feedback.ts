import * as m from '@/paraglide/messages.js'

export function formatChannelLifecycleConflict(blockers: readonly string[]): string {
    if (!blockers.length) return m.channel_blocked_generic()
    return [...new Set(blockers)]
        .map(blocker =>
            blocker === 'publications'
                ? m.channel_blocked_publications()
                : blocker === 'publisher'
                  ? m.channel_blocked_publisher()
                  : blocker === 'pending_authorization'
                    ? m.channel_blocked_authorization()
                    : blocker === 'shared'
                      ? m.channel_blocked_shared()
                      : blocker === 'must_be_archived'
                        ? m.channel_blocked_archive()
                        : blocker === 'active_work'
                          ? m.channel_blocked_work()
                          : m.channel_blocked_generic()
        )
        .join(' ')
}
