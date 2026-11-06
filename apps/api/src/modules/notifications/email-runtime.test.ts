import { it } from 'bun:test'

import { expect } from '@playwright/test'
import {
    createAccessStore,
    createManualStore,
    createEventJournalStore,
    createNotificationEmailStore,
    createNotificationDeliveryStore,
} from '@postdot/db'
import { closeTestDatabase, openTestDatabase } from '@postdot/db/testing'
import type { SendMailOptions } from 'nodemailer'

import { classifySmtpFailure, createNotificationEmailRuntime } from './email-runtime'

async function fixture() {
    const database = (await openTestDatabase()).database
    await database.sql.exec(
        "insert into \"user\" (id, name, email, email_verified, created_at, updated_at) values ('owner', 'Owner', 'owner@example.test', 1, 1, 1)"
    )
    const access = createAccessStore(database)
    await access.claimFirstAccount({ userId: 'owner' })
    const project = await createManualStore(database).createProject({
        name: 'Alerts',
        subjectId: 'owner',
        displayName: 'Owner',
        workspaceId: (await access.getDefaultWorkspace())!.id,
    })
    await access.ensureProjectOwnerMembership({ projectId: project.project.id, userId: 'owner' })
    const store = createNotificationEmailStore(database)
    const journal = createEventJournalStore(database)
    const append = (name = 'publication.execution.failed') =>
        journal.append({
            id: crypto.randomUUID(),
            projectId: project.project.id,
            actorId: project.actor.id,
            name,
            version: 1,
            subject: { type: 'publication', id: 'post' },
            occurredAt: Date.now(),
        })
    return { database, access, projectId: project.project.id, store, append }
}

it('enrolls future outcomes only, deduplicates replay and never reenables a disabled backlog', async () => {
    const f = await fixture()
    try {
        expect((await f.store.preferences(f.projectId, 'owner'))?.enabled).toBe(false)
        await f.append()
        expect((await f.store.setEnabled(f.projectId, 'owner', true))?.enabled).toBe(true)
        expect((await f.store.deliveries.project(f.projectId)).created).toBe(0)
        await f.append()
        await f.append('publication.execution.ambiguous')
        await f.append('publication.execution.published')
        expect((await f.store.deliveries.project(f.projectId)).created).toBe(2)
        expect((await f.store.deliveries.project(f.projectId)).created).toBe(0)
        await f.store.setEnabled(f.projectId, 'owner', false)
        expect(await f.store.deliveries.getNextAttemptAt()).toBeNull()
        await f.append()
        await f.store.setEnabled(f.projectId, 'owner', true)
        expect((await f.store.deliveries.project(f.projectId)).created).toBe(0)
        expect(await f.store.deliveries.getNextAttemptAt()).toBeNull()
        await f.append()
        expect((await f.store.deliveries.project(f.projectId)).created).toBe(1)
        const delivery = (await f.store.deliveries.list(f.projectId, 'owner'))![0]!
        expect(await f.store.resolveRecipient(delivery)).toBe('owner@example.test')
        await f.database.sql.exec(
            "update \"user\" set email = 'new@example.test' where id = 'owner'"
        )
        expect(await f.store.resolveRecipient(delivery)).toBe('new@example.test')
        await f.database.sql.exec('update "user" set email_verified = 0 where id = \'owner\'')
        expect(await f.store.resolveRecipient(delivery)).toBeNull()
        expect(await f.store.setEnabled(f.projectId, 'owner', true)).toBeNull()
        await f.database.sql.exec(
            "update instance_memberships set state = 'disabled' where user_id = 'owner'"
        )
        expect(await f.store.preferences(f.projectId, 'owner')).toBeNull()
        expect(await f.store.resolveRecipient(delivery)).toBeNull()
        await f.append()
        expect((await f.store.deliveries.project(f.projectId)).created).toBe(0)
    } finally {
        await closeTestDatabase(f.database)
    }
})

it('does not notify a removed member whose historical actor remains', async () => {
    const f = await fixture()
    try {
        await f.database.sql
            .exec(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('member', 'Member', 'member@example.test', 1, 1, 1);
            insert into instance_memberships (id, user_id, role, state, created_at, updated_at) values ('membership', 'member', 'member', 'enabled', 1, 1);`)
        await f.database.sql
            .statement(
                'insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, ?)'
            )
            .run(
                'workspace-member',
                (await f.access.getDefaultWorkspace())!.organizationId,
                'member',
                'member',
                1
            )
        await f.access.grantProjectUserAccess({
            projectId: f.projectId,
            userId: 'member',
            role: 'viewer',
        })
        expect((await f.store.setEnabled(f.projectId, 'member', true))?.enabled).toBe(true)
        await f.append()
        expect((await f.store.deliveries.project(f.projectId)).created).toBe(1)
        const delivery = (await f.store.deliveries.list(f.projectId, 'member'))![0]!
        expect(await f.store.resolveRecipient(delivery)).toBe('member@example.test')
        expect(await f.access.removeProjectUserAccess(f.projectId, 'member')).toBe(true)
        expect(
            await f.database.sql
                .statement(
                    'select count(*) as count from actors where project_id = ? and subject_id = ?'
                )
                .get(f.projectId, 'member')
        ).toEqual({ count: 1 })
        expect(await f.store.resolveRecipient(delivery)).toBeNull()
        await f.append()
        expect((await f.store.deliveries.project(f.projectId)).created).toBe(0)
    } finally {
        await closeTestDatabase(f.database)
    }
})

it('delivers escaped HTML and text, recovers startup backlog, and keeps SMTP uncertainty terminal', async () => {
    const f = await fixture()
    const sent: SendMailOptions[] = []
    await f.store.setEnabled(f.projectId, 'owner', true)
    await f.append()
    let reject = false
    const runtime = createNotificationEmailRuntime({
        store: f.store,
        webOrigin: 'https://postdot.example.test',
        smtp: { host: 'unused', port: 25, secure: false, from: 'alerts@example.test' },
        transport: {
            async sendMail(message) {
                sent.push(message)
                if (reject) throw new Error('secret material')
                return { accepted: ['owner@example.test'] }
            },
        },
    })
    try {
        await runtime.start()
        await expect
            .poll(async () => (await f.store.deliveries.list(f.projectId, 'owner'))?.[0]?.state)
            .toBe('delivered')
        expect(sent[0]?.to).toBe('owner@example.test')
        expect(sent[0]?.text).toContain('https://postdot.example.test/dashboard/projects/')
        expect(sent[0]?.html).toContain('Open publication')
        reject = true
        await f.append('publication.execution.ambiguous')
        await runtime.runProjects([f.projectId])
        await expect
            .poll(async () => (await f.store.deliveries.list(f.projectId, 'owner'))?.[0]?.state)
            .toBe('ambiguous')
        await runtime.runProjects([f.projectId])
        await runtime.stop()
        expect(sent).toHaveLength(2)
        expect((await f.store.deliveries.list(f.projectId, 'owner'))?.[0]?.lastError).not.toContain(
            'secret material'
        )
    } finally {
        await runtime.stop()
        await closeTestDatabase(f.database)
    }
})

it('does not project, claim or recover another transport delivery', async () => {
    const f = await fixture()
    const other = createNotificationDeliveryStore(f.database, { transportId: 'other' })
    const destination = (await other.createDestination({
        projectId: f.projectId,
        subjectId: 'owner',
        transportId: 'other',
        label: 'Other',
        configuration: {},
    }))!
    await other.subscribe({
        projectId: f.projectId,
        subjectId: 'owner',
        destinationId: destination.id,
        kind: 'publication_failed',
        enabled: true,
    })
    try {
        await f.store.setEnabled(f.projectId, 'owner', true)
        await f.append()
        expect((await f.store.deliveries.project(f.projectId)).created).toBe(1)
        expect((await other.project(f.projectId)).created).toBe(1)
        await f.store.setEnabled(f.projectId, 'owner', false)
        expect(await f.store.deliveries.getNextAttemptAt()).toBeNull()
        expect(
            await f.store.deliveries.claimNextDueJob({
                actorId: 'worker',
                claimToken: 'email',
                now: Date.now(),
                leaseExpiresAt: Date.now() + 1000,
            })
        ).toBeNull()
        const claimed = (await other.claimNextDueJob({
            actorId: 'worker',
            claimToken: 'other',
            now: Date.now(),
            leaseExpiresAt: Date.now() + 1000,
        }))!
        expect(claimed.transportId).toBe('other')
        expect(await f.store.deliveries.recoverExpiredClaims(Date.now() + 2000)).toEqual({
            requeuedJobIds: [],
            ambiguousJobIds: [],
        })
        expect(
            (await other.list(f.projectId, 'owner'))?.find(d => d.id === claimed.id)?.state
        ).toBe('running')
    } finally {
        await closeTestDatabase(f.database)
    }
})

it('distinguishes explicit SMTP rejection from unknown post-dispatch outcomes', () => {
    expect(classifySmtpFailure({ responseCode: 451 }).type).toBe('retryable_failure')
    expect(classifySmtpFailure({ responseCode: 550 }).type).toBe('permanent_failure')
    // Nodemailer also labels post-DATA socket timeouts CONN; it is not proof of no effect.
    expect(classifySmtpFailure({ command: 'CONN' }).type).toBe('ambiguous')
    expect(classifySmtpFailure({ command: 'DATA', code: 'ETIMEDOUT' }).type).toBe('ambiguous')
})

it('keeps disabled SMTP work pending and resumes it when configuration becomes available', async () => {
    const f = await fixture()
    let smtp: { host: string; port: number; secure: boolean; from: string } | undefined
    const messages: SendMailOptions[] = []
    const runtime = createNotificationEmailRuntime({
        store: f.store,
        getSmtp: () => smtp,
        webOrigin: 'https://postdot.example.test',
        transport: {
            async sendMail(message) {
                messages.push(message)
            },
        },
    })
    try {
        await f.store.setEnabled(f.projectId, 'owner', true)
        await f.append()
        await f.store.deliveries.project(f.projectId)
        await runtime.start()
        expect(messages).toHaveLength(0)
        expect(
            await f.database.sql.statement('select state from notification_deliveries').get()
        ).toMatchObject({ state: 'pending' })
        smtp = { host: 'unused', port: 25, secure: false, from: 'new@example.test' }
        await runtime.replan()
        await expect.poll(() => messages.length).toBe(1)
        expect(messages[0]?.from).toBe('new@example.test')
    } finally {
        await runtime.stop()
        await closeTestDatabase(f.database)
    }
})
