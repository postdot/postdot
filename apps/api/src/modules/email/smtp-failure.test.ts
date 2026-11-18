// cspell:ignore ECONNECTION ESOCKET EENVELOPE ETIMEOUT ESOCKETTIMEDOUT EAUTH ENOTFOUND EDNS ETLS EPROTO RCPT
import { describe, expect, test } from 'bun:test'

import { describeSmtpFailure } from './smtp-failure'

function failure(fields: Record<string, unknown>) {
    return Object.assign(new Error(String(fields.message ?? 'failed')), fields)
}

describe('describeSmtpFailure', () => {
    test('names a rejected login and keeps the server reply', () => {
        expect(
            describeSmtpFailure(
                failure({
                    code: 'EAUTH',
                    command: 'AUTH PLAIN',
                    responseCode: 535,
                    response: '535 5.7.8 Authentication credentials invalid',
                })
            )
        ).toEqual({
            reason: 'authentication',
            serverReply: '535 5.7.8 Authentication credentials invalid',
            code: 'EAUTH',
            command: 'AUTH PLAIN',
            responseCode: 535,
        })
    })

    test('tells a blocked port from a refused one and from an unknown host', () => {
        // A firewall or network policy dropping the port shows as a timeout.
        expect(describeSmtpFailure(failure({ code: 'ETIMEDOUT' })).reason).toBe('timeout')
        expect(
            describeSmtpFailure(failure({ code: 'ECONNECTION', message: 'Connection timeout' }))
                .reason
        ).toBe('timeout')
        expect(describeSmtpFailure(failure({ code: 'ECONNREFUSED' })).reason).toBe('refused')
        expect(describeSmtpFailure(failure({ code: 'ENOTFOUND' })).reason).toBe('dns')
    })

    test('recognizes certificate and protocol problems', () => {
        expect(describeSmtpFailure(failure({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })).reason).toBe(
            'tls'
        )
        expect(
            describeSmtpFailure(
                failure({ code: 'ESOCKET', message: 'wrong version number (ssl3_get_record)' })
            ).reason
        ).toBe('tls')
    })

    test('says which address the server refused', () => {
        expect(
            describeSmtpFailure(
                failure({
                    code: 'EENVELOPE',
                    command: 'MAIL FROM',
                    responseCode: 550,
                    response: '550 5.7.1 Sender address not allowed',
                })
            ).reason
        ).toBe('sender_rejected')
        expect(
            describeSmtpFailure(
                failure({ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550 })
            ).reason
        ).toBe('recipient_rejected')
    })

    test('keeps the reply on one bounded line and survives values that are not errors', () => {
        const long = `550 ${'x'.repeat(500)}\r\nsecond line`
        const reply = describeSmtpFailure(failure({ response: long })).serverReply!
        expect(reply).not.toContain('\n')
        expect(reply.length).toBeLessThanOrEqual(301)
        expect(describeSmtpFailure('boom')).toEqual({ reason: 'unknown' })
    })
})
