import { it } from 'bun:test'

import {
    closeDatabase,
    createDatabase,
    runMigrations,
    createAccessStore,
    createManualStore,
    createEventJournalStore,
    createNotificationEmailStore,
    createNotificationDeliveryStore,
} from '@herald/db'
import { expect } from '@playwright/test'
import type { SendMailOptions } from 'nodemailer'

import { classifySmtpFailure, createNotificationEmailRuntime } from './email-runtime'

function fixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)
    database.$client.exec(
        "insert into user (id, name, email, email_verified, created_at, updated_at) values ('owner', 'Owner', 'owner@example.test', 1, 1, 1)"
    )
    const access = createAccessStore(database)
    access.claimFirstAccount({ userId: 'owner' })
    const project = createManualStore(database).createProject({
        name: 'Alerts',
        subjectId: 'owner',
        displayName: 'Owner',
        workspaceId: access.getDefaultWorkspace()!.id,
    })
    access.ensureProjectOwnerMembership({ projectId: project.project.id, userId: 'owner' })
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

it('enrolls future outcomes only, deduplicates replay and never reenables a disabled backlog', () => {
    const f = fixture()
    try {
        expect(f.store.preferences(f.projectId, 'owner')?.enabled).toBe(false)
        f.append()
        expect(f.store.setEnabled(f.projectId, 'owner', true)?.enabled).toBe(true)
        expect(f.store.deliveries.project(f.projectId).created).toBe(0)
        f.append()
        f.append('publication.execution.ambiguous')
        f.append('publication.execution.published')
        expect(f.store.deliveries.project(f.projectId).created).toBe(2)
        expect(f.store.deliveries.project(f.projectId).created).toBe(0)
        f.store.setEnabled(f.projectId, 'owner', false)
        expect(f.store.deliveries.getNextAttemptAt()).toBeNull()
        f.append()
        f.store.setEnabled(f.projectId, 'owner', true)
        expect(f.store.deliveries.project(f.projectId).created).toBe(0)
        expect(f.store.deliveries.getNextAttemptAt()).toBeNull()
        f.append()
        expect(f.store.deliveries.project(f.projectId).created).toBe(1)
        const delivery = f.store.deliveries.list(f.projectId, 'owner')![0]!
        expect(f.store.resolveRecipient(delivery)).toBe('owner@example.test')
        f.database.$client.exec("update user set email = 'new@example.test' where id = 'owner'")
        expect(f.store.resolveRecipient(delivery)).toBe('new@example.test')
        f.database.$client.exec("update user set email_verified = 0 where id = 'owner'")
        expect(f.store.resolveRecipient(delivery)).toBeNull()
        expect(f.store.setEnabled(f.projectId, 'owner', true)).toBeNull()
        f.database.$client.exec(
            "update instance_memberships set state = 'disabled' where user_id = 'owner'"
        )
        expect(f.store.preferences(f.projectId, 'owner')).toBeNull()
        expect(f.store.resolveRecipient(delivery)).toBeNull()
        f.append()
        expect(f.store.deliveries.project(f.projectId).created).toBe(0)
    } finally {
        closeDatabase(f.database)
    }
})

it('does not notify a removed member whose historical actor remains', () => {
    const f = fixture()
    try {
        f.database.$client
            .exec(`insert into user (id, name, email, email_verified, created_at, updated_at) values ('member', 'Member', 'member@example.test', 1, 1, 1);
            insert into instance_memberships (id, user_id, role, state, created_at, updated_at) values ('membership', 'member', 'member', 'enabled', 1, 1);`)
        f.database.$client
            .query(
                'insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, ?)'
            )
            .run(
                'workspace-member',
                f.access.getDefaultWorkspace()!.organizationId,
                'member',
                'member',
                1
            )
        f.access.grantProjectUserAccess({
            projectId: f.projectId,
            userId: 'member',
            role: 'viewer',
        })
        expect(f.store.setEnabled(f.projectId, 'member', true)?.enabled).toBe(true)
        f.append()
        expect(f.store.deliveries.project(f.projectId).created).toBe(1)
        const delivery = f.store.deliveries.list(f.projectId, 'member')![0]!
        expect(f.store.resolveRecipient(delivery)).toBe('member@example.test')
        expect(f.access.removeProjectUserAccess(f.projectId, 'member')).toBe(true)
        expect(
            f.database.$client
                .query(
                    'select count(*) as count from actors where project_id = ? and subject_id = ?'
                )
                .get(f.projectId, 'member')
        ).toEqual({ count: 1 })
        expect(f.store.resolveRecipient(delivery)).toBeNull()
        f.append()
        expect(f.store.deliveries.project(f.projectId).created).toBe(0)
    } finally {
        closeDatabase(f.database)
    }
})

it('delivers escaped HTML and text, recovers startup backlog, and keeps SMTP uncertainty terminal', async () => {
    const f = fixture()
    const sent: SendMailOptions[] = []
    f.store.setEnabled(f.projectId, 'owner', true)
    f.append()
    let reject = false
    const runtime = createNotificationEmailRuntime({
        store: f.store,
        webOrigin: 'https://herald.example.test',
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
        runtime.start()
        await expect
            .poll(() => f.store.deliveries.list(f.projectId, 'owner')?.[0]?.state)
            .toBe('delivered')
        expect(sent[0]?.to).toBe('owner@example.test')
        expect(sent[0]?.text).toContain('https://herald.example.test/dashboard/projects/')
        expect(sent[0]?.html).toContain('Open publication')
        reject = true
        f.append('publication.execution.ambiguous')
        runtime.runProjects([f.projectId])
        await expect
            .poll(() => f.store.deliveries.list(f.projectId, 'owner')?.[0]?.state)
            .toBe('ambiguous')
        runtime.runProjects([f.projectId])
        await runtime.stop()
        expect(sent).toHaveLength(2)
        expect(f.store.deliveries.list(f.projectId, 'owner')?.[0]?.lastError).not.toContain(
            'secret material'
        )
    } finally {
        await runtime.stop()
        closeDatabase(f.database)
    }
})

it('does not project, claim or recover another transport delivery', async () => {
    const f = fixture()
    const other = createNotificationDeliveryStore(f.database, { transportId: 'other' })
    const destination = other.createDestination({
        projectId: f.projectId,
        subjectId: 'owner',
        transportId: 'other',
        label: 'Other',
        configuration: {},
    })!
    other.subscribe({
        projectId: f.projectId,
        subjectId: 'owner',
        destinationId: destination.id,
        kind: 'publication_failed',
        enabled: true,
    })
    try {
        f.store.setEnabled(f.projectId, 'owner', true)
        f.append()
        expect(f.store.deliveries.project(f.projectId).created).toBe(1)
        expect(other.project(f.projectId).created).toBe(1)
        f.store.setEnabled(f.projectId, 'owner', false)
        expect(f.store.deliveries.getNextAttemptAt()).toBeNull()
        expect(
            f.store.deliveries.claimNextDueJob({
                actorId: 'worker',
                claimToken: 'email',
                now: Date.now(),
                leaseExpiresAt: Date.now() + 1000,
            })
        ).toBeNull()
        const claimed = other.claimNextDueJob({
            actorId: 'worker',
            claimToken: 'other',
            now: Date.now(),
            leaseExpiresAt: Date.now() + 1000,
        })!
        expect(claimed.transportId).toBe('other')
        expect(f.store.deliveries.recoverExpiredClaims(Date.now() + 2000)).toEqual({
            requeuedJobIds: [],
            ambiguousJobIds: [],
        })
        expect(other.list(f.projectId, 'owner')?.find(d => d.id === claimed.id)?.state).toBe(
            'running'
        )
    } finally {
        closeDatabase(f.database)
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
    const f = fixture()
    let smtp: { host: string; port: number; secure: boolean; from: string } | undefined
    const messages: SendMailOptions[] = []
    const runtime = createNotificationEmailRuntime({
        store: f.store,
        getSmtp: () => smtp,
        webOrigin: 'https://herald.example.test',
        transport: {
            async sendMail(message) {
                messages.push(message)
            },
        },
    })
    try {
        f.store.setEnabled(f.projectId, 'owner', true)
        f.append()
        f.store.deliveries.project(f.projectId)
        runtime.start()
        expect(messages).toHaveLength(0)
        expect(
            f.database.$client.query('select state from notification_deliveries').get()
        ).toMatchObject({ state: 'pending' })
        smtp = { host: 'unused', port: 25, secure: false, from: 'new@example.test' }
        runtime.replan()
        await expect.poll(() => messages.length).toBe(1)
        expect(messages[0]?.from).toBe('new@example.test')
    } finally {
        await runtime.stop()
        closeDatabase(f.database)
    }
})
