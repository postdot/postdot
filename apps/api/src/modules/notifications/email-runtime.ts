import {
    NextEventScheduler,
    createExponentialRetryPolicy,
    processNextExternalEffect,
    type ExternalEffectOutcome,
} from '@postbot/core'
import type { NotificationEmailStore } from '@postbot/db'
import { renderPostbotPublicationOutcomeEmail } from '@postbot/email'
import { createTransport, type SendMailOptions } from 'nodemailer'

import type { PostbotSmtpConfig } from '../email/delivery'
import { createNotificationProjectionRuntime } from './runtime'

export function createNotificationEmailRuntime(options: {
    store: NotificationEmailStore
    smtp?: PostbotSmtpConfig
    getSmtp?: () => PostbotSmtpConfig | undefined
    webOrigin: string
    transport?: { sendMail(message: SendMailOptions): Promise<unknown> }
}) {
    const { store } = options
    const getSmtp = options.getSmtp ?? (() => options.smtp)
    const smtp = options.smtp
    const transport =
        options.transport ??
        createTransport({
            host: smtp!.host,
            port: smtp!.port,
            secure: smtp!.secure,
            connectionTimeout: 15_000,
            greetingTimeout: 15_000,
            socketTimeout: 30_000,
            ...(smtp!.username === undefined
                ? {}
                : { auth: { user: smtp!.username, pass: smtp!.password! } }),
        })
    const scheduler = new NextEventScheduler({
        getNextEventAt: () =>
            getSmtp() === undefined ? null : store.deliveries.getNextAttemptAt(),
        onError: () => console.error('[postbot-notification-email] delivery scheduler failed'),
        async processDueEvents() {
            for (let count = 0; count < 100; count++) {
                if (getSmtp() === undefined) break
                const result = await processNextExternalEffect({
                    store: store.deliveries,
                    actorId: 'notification-email-worker',
                    leaseDuration: 120_000,
                    createClaimToken: () => crypto.randomUUID(),
                    retryPolicy: createExponentialRetryPolicy({
                        maxAttempts: 3,
                        initialDelay: 60_000,
                        maximumDelay: 300_000,
                    }),
                    async performExternalEffect(delivery): Promise<ExternalEffectOutcome> {
                        const email = store.resolveRecipient(delivery)
                        if (email === null)
                            return {
                                type: 'permanent_failure',
                                effectOccurred: false,
                                errorMessage: 'The email recipient is no longer eligible',
                            }
                        if (
                            delivery.kind !== 'publication_failed' &&
                            delivery.kind !== 'publication_ambiguous'
                        )
                            return {
                                type: 'permanent_failure',
                                effectOccurred: false,
                                errorMessage: 'Unsupported email alert kind',
                            }
                        const url = new URL(
                            `/dashboard/projects/${encodeURIComponent(delivery.projectId)}/publications/${encodeURIComponent(delivery.subject.id)}`,
                            options.webOrigin
                        )
                        try {
                            const message = await renderPostbotPublicationOutcomeEmail({
                                email,
                                title: delivery.title,
                                body: delivery.body,
                                url: url.toString(),
                            })
                            if (
                                store.resolveRecipient(delivery) !== email ||
                                getSmtp() === undefined
                            )
                                return {
                                    type: 'permanent_failure',
                                    effectOccurred: false,
                                    errorMessage: 'The email recipient changed before dispatch',
                                }
                            await transport.sendMail({ ...message, from: getSmtp()?.from })
                            return { type: 'published' }
                        } catch (error) {
                            // SMTP may have accepted DATA before the connection failed. Never blindly resend.
                            return classifySmtpFailure(error)
                        }
                    },
                })
                if (result.outcome === 'idle') break
            }
        },
    })
    const projection = createNotificationProjectionRuntime(
        {
            listProjectIds: () => store.deliveries.listProjectIds(),
            project(projectId) {
                const result = store.deliveries.project(projectId)
                if (scheduler.state === 'started') scheduler.replan()
                return result
            },
        },
        { onError: () => console.error('[postbot-notification-email] projection failed') }
    )
    return {
        start() {
            store.deliveries.recoverExpiredClaims(Date.now())
            scheduler.start()
            projection.start()
        },
        runProjects: projection.runProjects,
        replan() {
            if (scheduler.state === 'started' || scheduler.state === 'running') scheduler.replan()
        },
        async stop() {
            projection.stop()
            await scheduler.stop()
        },
    }
}

export function classifySmtpFailure(error: unknown): ExternalEffectOutcome {
    const failure =
        typeof error === 'object' && error !== null ? (error as { responseCode?: unknown }) : {}
    if (
        typeof failure.responseCode === 'number' &&
        failure.responseCode >= 400 &&
        failure.responseCode < 600
    ) {
        return {
            type: failure.responseCode < 500 ? 'retryable_failure' : 'permanent_failure',
            effectOccurred: false,
            errorMessage: 'SMTP rejected the email',
        }
    }
    return { type: 'ambiguous', errorMessage: 'The SMTP delivery outcome could not be confirmed' }
}
