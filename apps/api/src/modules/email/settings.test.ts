import { it, expect } from 'bun:test'

import { expect as browserExpect } from '@playwright/test'
import { createAuth } from '@postdot/auth'
import {
    createDatabase,
    closeDatabase,
    runMigrations,
    createSecretCipher,
    createInstallationEmailSettingsStore,
} from '@postdot/db'
import type { SendMailOptions } from 'nodemailer'

import { createPostdotAuthEmailDelivery } from './delivery'
import { createEmailSettingsService } from './settings'

it('encrypts settings, preserves or removes passwords explicitly, and reloads without falling back to deployment', async () => {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const cipher = createSecretCipher({
        domain: 'postdot.installation-email',
        keyId: 'test',
        key: new Uint8Array(32).fill(7),
    })
    const store = createInstallationEmailSettingsStore(database, cipher)
    const initial = {
        host: 'initial.example.test',
        port: 587,
        secure: false,
        from: 'sender@example.test',
    }
    const sent: { host: string; message: SendMailOptions }[] = []
    const service = await createEmailSettingsService({
        store,
        initial,
        createTransport: smtp => ({
            async sendMail(message) {
                sent.push({ host: smtp.host, message })
            },
        }),
    })
    try {
        expect(service.view().source).toBe('deployment')
        await service.save({
            ...initial,
            enabled: true,
            host: 'smtp.example.test',
            username: 'mailer',
            password: 'FAKE_SMTP_SECRET_355',
        })
        const persisted = database.$client.query('select * from installation_email_settings').get()
        expect(JSON.stringify(persisted)).not.toContain('FAKE_SMTP_SECRET_355')
        expect(JSON.stringify(service.view())).not.toContain('FAKE_SMTP_SECRET_355')
        await service.save({
            ...initial,
            enabled: true,
            host: 'second.example.test',
            username: 'mailer',
        })
        expect(service.current()?.password).toBe('FAKE_SMTP_SECRET_355')
        await service.test('admin@example.test')
        expect(sent[0]?.host).toBe('second.example.test')
        expect(sent[0]?.message.to).toBe('admin@example.test')
        await service.save({ ...initial, enabled: false, username: '', password: null })
        expect(service.current()).toBeUndefined()
        expect(service.view().hasPassword).toBe(false)
        const restarted = await createEmailSettingsService({ store, initial })
        expect(restarted.current()).toBeUndefined()
        expect(restarted.view().source).toBe('database')
        await expect(restarted.test('admin@example.test')).rejects.toThrow('disabled')
        const wrong = createInstallationEmailSettingsStore(
            database,
            createSecretCipher({
                domain: 'postdot.installation-email',
                keyId: 'wrong',
                key: new Uint8Array(32).fill(3),
            })
        )
        await expect(wrong.read()).rejects.toThrow()
    } finally {
        closeDatabase(database)
    }
})

it('applies newly saved SMTP to existing auth callbacks and keeps disabled delivery silent', async () => {
    const database = createDatabase(':memory:')
    runMigrations(database)
    const store = createInstallationEmailSettingsStore(
        database,
        createSecretCipher({
            domain: 'postdot.installation-email',
            keyId: 'test',
            key: new Uint8Array(32).fill(7),
        })
    )
    const messages: SendMailOptions[] = []
    const service = await createEmailSettingsService({
        store,
        createTransport: () => ({
            async sendMail(message) {
                messages.push(message)
            },
        }),
    })
    const delivery = createPostdotAuthEmailDelivery({
        getSmtp: service.current,
        transport: service,
        webOrigin: 'http://localhost:5173',
    })
    const verification = {
        user: { email: 'recipient@example.test', name: 'Recipient' },
        url: 'https://postdot.example.test/verify',
        token: 'fixture-token',
    }
    try {
        await delivery.sendEmailVerification?.(verification)
        expect(messages).toHaveLength(0)
        await service.save({
            enabled: true,
            host: 'mail.example.test',
            port: 587,
            secure: false,
            username: '',
            from: 'new@example.test',
        })
        await delivery.sendEmailVerification?.(verification)
        await browserExpect.poll(() => messages.length).toBe(1)
        expect(messages).toHaveLength(1)
        expect(messages[0]?.from).toBe('new@example.test')
    } finally {
        closeDatabase(database)
    }
})

it('preserves Better Auth disabled-email responses while allowing a later configuration', async () => {
    const database = createDatabase(':memory:')
    runMigrations(database)
    let available = false
    const auth = createAuth(database, {
        baseURL: 'http://localhost:3000',
        secret: 'fixture-secret-with-at-least-32-characters',
        emailDeliveryAvailable: () => available,
        sendPasswordResetEmail: () => {},
        sendEmailVerification: () => {},
    })
    const request = (path: string) =>
        auth.handler(
            new Request(`http://localhost:3000/api/auth/${path}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
                body: JSON.stringify({ email: 'unknown@example.test' }),
            })
        )
    try {
        const disabled = await request('request-password-reset')
        expect(disabled.status).toBe(400)
        expect(await disabled.json()).toMatchObject({ code: 'RESET_PASSWORD_DISABLED' })
        const verification = await request('send-verification-email')
        expect(verification.status).toBe(400)
        expect(await verification.json()).toMatchObject({ code: 'VERIFICATION_EMAIL_NOT_ENABLED' })
        available = true
        expect((await request('request-password-reset')).status).toBe(200)
        available = false
        expect((await request('request-password-reset')).status).toBe(400)
    } finally {
        closeDatabase(database)
    }
})

it('blocks all SMTP delivery during recovery without contacting the transport', async () => {
    const database = createDatabase(':memory:')
    runMigrations(database)
    let held = true
    let sends = 0
    try {
        const service = await createEmailSettingsService({
            store: createInstallationEmailSettingsStore(
                database,
                createSecretCipher({
                    domain: 'postdot.installation-email',
                    keyId: 'test',
                    key: new Uint8Array(32).fill(7),
                })
            ),
            initial: {
                host: 'smtp.example.test',
                port: 587,
                secure: false,
                from: 'sender@example.test',
            },
            deliveryAllowed: () => !held,
            createTransport: () => ({
                async sendMail() {
                    sends++
                },
            }),
        })
        await expect(service.test('admin@example.test')).rejects.toThrow('recovery')
        await expect(
            service.sendMail({ to: 'user@example.test', text: 'Auth or alert delivery' })
        ).rejects.toThrow('recovery')
        expect(sends).toBe(0)
        held = false
        await service.test('admin@example.test')
        expect(sends).toBe(1)
    } finally {
        closeDatabase(database)
    }
})
