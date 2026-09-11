export function formatInvitationRole(role: string): string {
    const roles = role
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    if (roles.length === 0) return 'a project member'
    return roles.join(' and ')
}

export function formatInvitationExpiry(value: Date): string {
    return new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
    }).format(value)
}
