import type { createInstallationEmailSettingsStore } from '@postdot/db'
import { createTransport, type SendMailOptions } from 'nodemailer'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

import type { PostbotSmtpConfig } from './delivery'

const smtpFields = {
    host: Type.String({ minLength: 1, maxLength: 253, pattern: '^[^\\s/:]+$' }),
    port: Type.Integer({ minimum: 1, maximum: 65535 }),
    secure: Type.Boolean(),
    from: Type.String({ minLength: 3, maxLength: 320, pattern: '^[^\\r\\n]+@[^\\r\\n]+$' }),
    username: Type.String({ maxLength: 320 }),
}
export const emailSettingsInputSchema = Type.Object({
    ...smtpFields,
    enabled: Type.Boolean(),
    password: Type.Optional(
        Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()])
    ),
})
export const emailSettingsSchema = Type.Object({
    ...smtpFields,
    host: Type.String(),
    from: Type.String(),
    enabled: Type.Boolean(),
    hasPassword: Type.Boolean(),
    source: Type.Union([
        Type.Literal('database'),
        Type.Literal('deployment'),
        Type.Literal('none'),
    ]),
})
export type EmailSettingsInput = Static<typeof emailSettingsInputSchema>
export type EmailSettingsResponse = Static<typeof emailSettingsSchema>
const storedSchema = Type.Object({
    enabled: Type.Boolean(),
    smtp: Type.Object({ ...smtpFields, password: Type.Optional(Type.String({ minLength: 1 })) }),
})

export async function createEmailSettingsService(options: {
    store: ReturnType<typeof createInstallationEmailSettingsStore>
    initial?: PostbotSmtpConfig
    onChange?: () => void
    deliveryAllowed?: () => boolean
    createTransport?: (smtp: PostbotSmtpConfig) => {
        sendMail(message: SendMailOptions): Promise<unknown>
    }
}) {
    const persisted = await options.store.read()
    let stored: Static<typeof storedSchema> | null = null
    if (persisted !== null) {
        const decoded: unknown = JSON.parse(persisted)
        if (!Value.Check(storedSchema, decoded))
            throw new Error('Stored email configuration is invalid')
        stored = decoded
    }
    const configured = () => stored?.smtp ?? options.initial
    const current = (): PostbotSmtpConfig | undefined =>
        stored?.enabled === false ? undefined : configured()
    const view = (): EmailSettingsResponse => {
        const smtp = configured()
        return {
            host: smtp?.host ?? '',
            port: smtp?.port ?? 587,
            secure: smtp?.secure ?? false,
            from: smtp?.from ?? '',
            username: smtp?.username ?? '',
            enabled: current() !== undefined,
            hasPassword: Boolean(smtp?.password),
            source: stored !== null ? 'database' : options.initial ? 'deployment' : 'none',
        }
    }
    let tail = Promise.resolve()
    const sendMail = async (message: SendMailOptions) => {
        if (options.deliveryAllowed?.() === false)
            throw new Error('Email delivery is suspended during recovery')
        const smtp = current()
        if (smtp === undefined) throw new Error('Email delivery is disabled')
        const transport =
            options.createTransport?.(smtp) ??
            createTransport({
                host: smtp.host,
                port: smtp.port,
                secure: smtp.secure,
                connectionTimeout: 15_000,
                greetingTimeout: 15_000,
                socketTimeout: 30_000,
                ...(smtp.username ? { auth: { user: smtp.username, pass: smtp.password! } } : {}),
            })
        return transport.sendMail({ ...message, from: smtp.from })
    }
    return {
        current,
        view,
        sendMail,
        async save(input: EmailSettingsInput) {
            const operation = tail.then(async () => {
                const password =
                    input.password === undefined
                        ? configured()?.password
                        : (input.password ?? undefined)
                if (Boolean(input.username) !== Boolean(password))
                    throw new Error('SMTP username and password must be supplied together')
                const next = {
                    enabled: input.enabled,
                    smtp: {
                        host: input.host,
                        port: input.port,
                        secure: input.secure,
                        from: input.from,
                        username: input.username,
                        ...(password === undefined ? {} : { password }),
                    },
                }
                await options.store.write(JSON.stringify(next))
                stored = next
                options.onChange?.()
            })
            tail = operation.catch(() => {})
            await operation
            return view()
        },
        async test(email: string) {
            await sendMail({
                to: email,
                subject: 'Postdot — SMTP test',
                text: 'Postdot successfully submitted this test email to your SMTP server.',
            })
            return { accepted: true as const }
        },
    }
}
export type EmailSettingsService = Awaited<ReturnType<typeof createEmailSettingsService>>
