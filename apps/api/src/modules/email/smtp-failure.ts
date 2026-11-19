// cspell:ignore ECONNECTION ESOCKET EENVELOPE ETIMEOUT ESOCKETTIMEDOUT EAUTH ENOTFOUND EDNS ETLS EPROTO RCPT
/**
 * Which step of an SMTP exchange failed, from a Nodemailer error. The reason is what a person
 * can act on; the server's reply is shown as it came, because it often names the exact cause
 * ("535 Authentication failed", "550 Sender not allowed"). Neither carries the password.
 */
export type SmtpFailureReason =
    | 'dns'
    | 'refused'
    | 'timeout'
    | 'tls'
    | 'authentication'
    | 'sender_rejected'
    | 'recipient_rejected'
    | 'unknown'

export interface SmtpFailure {
    readonly reason: SmtpFailureReason
    /** The SMTP server's own reply line, when it sent one. */
    readonly serverReply?: string
    /** Low-level error code and SMTP command, for the server log only. */
    readonly code?: string
    readonly command?: string
    readonly responseCode?: number
}

const TLS_CODES = new Set([
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'ERR_SSL_WRONG_VERSION_NUMBER',
    'EPROTO',
])

const REPLY_LIMIT = 300

export function describeSmtpFailure(error: unknown): SmtpFailure {
    const record = isRecord(error) ? error : {}
    const code = typeof record.code === 'string' ? record.code : undefined
    const command = typeof record.command === 'string' ? record.command : undefined
    const responseCode = typeof record.responseCode === 'number' ? record.responseCode : undefined
    const serverReply = cleanReply(record.response)
    const message = typeof record.message === 'string' ? record.message : ''
    const base = {
        ...(serverReply === undefined ? {} : { serverReply }),
        ...(code === undefined ? {} : { code }),
        ...(command === undefined ? {} : { command }),
        ...(responseCode === undefined ? {} : { responseCode }),
    }
    return { reason: reasonFor(code, command, responseCode, message), ...base }
}

function reasonFor(
    code: string | undefined,
    command: string | undefined,
    responseCode: number | undefined,
    message: string
): SmtpFailureReason {
    if (code === 'EAUTH' || responseCode === 535 || responseCode === 534) return 'authentication'
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EDNS') return 'dns'
    if (code === 'ECONNREFUSED') return 'refused'
    if (
        code === 'ETIMEDOUT' ||
        code === 'ETIMEOUT' ||
        code === 'ESOCKETTIMEDOUT' ||
        /timeout|timed out/i.test(message)
    )
        return 'timeout'
    if (
        (code !== undefined && TLS_CODES.has(code)) ||
        code === 'ETLS' ||
        /certificate|tls|ssl/i.test(message)
    )
        return 'tls'
    if (code === 'EENVELOPE' || (command !== undefined && responseCode !== undefined)) {
        const upper = command?.toUpperCase() ?? ''
        if (upper.startsWith('MAIL FROM')) return 'sender_rejected'
        if (upper.startsWith('RCPT TO')) return 'recipient_rejected'
    }
    if (code === 'ECONNECTION' || code === 'ESOCKET' || code === 'ECONNRESET') return 'refused'
    return 'unknown'
}

function cleanReply(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    // eslint-disable-next-line no-control-regex
    const line = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
    if (line === '') return undefined
    return line.length > REPLY_LIMIT ? `${line.slice(0, REPLY_LIMIT)}…` : line
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}
