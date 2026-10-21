import { readRecoveryHold, releaseRecoveryHold, type RecoveryHold } from '@postdot/db'

export interface RecoveryService {
    held(): boolean
    view(): { held: boolean; hold: RecoveryHold | null }
    resume(token: string): void
}

export function createRecoveryService(
    databaseFilename: string,
    onResume: () => void
): RecoveryService {
    let hold = readRecoveryHold(databaseFilename)
    return {
        held: () => hold !== null,
        view: () => ({ held: hold !== null, hold }),
        resume(token) {
            if (hold === null || hold.token !== token) throw new Error('Recovery hold changed')
            releaseRecoveryHold(databaseFilename, token)
            hold = null
            onResume()
        },
    }
}

/** Recovery is entered offline; no mutating request may cross it except acknowledgement. */
export function recoveryBlocksRequest(request: Request): boolean {
    const path = new URL(request.url).pathname
    if (
        path.startsWith('/api/auth/') &&
        !['/api/auth/sign-in/email', '/api/auth/sign-out', '/api/auth/get-session'].includes(path)
    )
        return true
    if (path.startsWith('/api/oauth/') && path.endsWith('/callback')) return true
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false
    if (request.method === 'POST' && path === '/api/settings/recovery/resume') return false
    return !['/api/auth/sign-in/email', '/api/auth/sign-out', '/api/auth/get-session'].includes(
        path
    )
}
