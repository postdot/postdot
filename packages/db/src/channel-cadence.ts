import { createHash } from 'node:crypto'

import { DomainInvariantError } from '@postdot/core'

import {
    createDatabaseTransaction,
    recordDatabaseCommitProject,
    type PostbotDatabase,
} from './client'

export interface ChannelCadence {
    channelId: string
    revision: number
    timeZone: string
    dailyMax: number | null
    weeklyMax: number | null
    minimumIntervalMs: number | null
}
export interface CadenceWarning {
    channelId: string
    rule: 'daily_max' | 'weekly_max'
    period: string
    maximum: number
    count: number
}
export class CadenceConflictError extends Error {
    constructor(
        readonly confirmation: string,
        readonly warnings: readonly CadenceWarning[]
    ) {
        super('Channel cadence requires explicit confirmation')
    }
}
export const cadenceFingerprint = (value: unknown) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function cadencePeriod(at: number, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(at)
    const part = (name: string) => parts.find(item => item.type === name)!.value
    const day = `${part('year')}-${part('month')}-${part('day')}`
    const date = new Date(`${day}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
    return { day, week: date.toISOString().slice(0, 10) }
}

/** SQL expression shared by discovery and claim, before a worker slot is occupied. */
export const cadenceEligibleAtSql = `max(jobs.run_at, coalesce((
    select case when r.minimum_interval_ms is null or exists (
        select 1 from publication_cadence_overrides o
        where o.publication_id = publications.id and o.rules_revision = r.revision
          and o.scheduled_at = publications.scheduled_at
    ) then 0 else case when r.last_effect_at is null and not exists (select 1 from publications p where p.channel_id=publications.channel_id and p.state='published') then 0 else max(coalesce(r.last_effect_at, 0), coalesce((
        select max(p.published_at) from publications p where p.channel_id = publications.channel_id
        and p.state = 'published'
    ), 0)) + r.minimum_interval_ms end end
    from channel_cadence r where r.channel_id = publications.channel_id
), 0))`

export function createChannelCadenceStore(database: PostbotDatabase) {
    const client = database.$client
    const get = (channelId: string): ChannelCadence | null =>
        client
            .query<ChannelCadence, [string]>(`
        select channel_id as channelId, revision, time_zone as timeZone, daily_max as dailyMax,
        weekly_max as weeklyMax, minimum_interval_ms as minimumIntervalMs from channel_cadence where channel_id=?
    `)
            .get(channelId)
    const timing = (projectId: string, publicationId: string) => {
        const row = client
            .query<
                { channelId: string; scheduledAt: number; state: string; runAt: number },
                [string, string]
            >(`
            select p.channel_id as channelId,p.scheduled_at as scheduledAt,p.state,
                coalesce((select j.run_at from jobs j where j.publication_id=p.id and j.state='pending' limit 1),p.scheduled_at) as runAt
            from publications p where p.project_id=? and p.id=? and p.delivery_mode='automatic' and p.state in ('scheduled','ready')
        `)
            .get(projectId, publicationId)
        if (!row || row.scheduledAt === null) return null
        const rules = get(row.channelId)
        const eligibleAt = client
            .query<{ at: number }, [number, string]>(`select ${cadenceEligibleAtSql} as at
            from (select ?1 as run_at) jobs join publications on publications.id=?2`)
            .get(row.runAt, publicationId)!.at
        return {
            scheduledAt: row.scheduledAt,
            eligibleAt,
            reason: eligibleAt > row.runAt ? ('minimum_interval' as const) : null,
            confirmation: cadenceFingerprint({ publicationId, ...row, rules, eligibleAt }),
        }
    }
    return {
        get,
        timing,
        override: createDatabaseTransaction(
            database,
            (input: {
                projectId: string
                publicationId: string
                actorId: string
                confirmation: string
                now: number
            }) => {
                const current = timing(input.projectId, input.publicationId)
                if (!current || current.reason === null) return null
                if (current.confirmation !== input.confirmation)
                    throw new CadenceConflictError(current.confirmation, [])
                const row = client
                    .query<{ channelId: string; state: string }, [string]>(
                        'select channel_id as channelId,state from publications where id=?'
                    )
                    .get(input.publicationId)!
                if (!['scheduled', 'ready'].includes(row.state))
                    throw new DomainInvariantError(
                        'invalid_transition',
                        'Only pending work can override spacing'
                    )
                const usable = client
                    .query(`select 1 from publications p join channels c on c.id=p.channel_id
                    join project_channel_attachments a on a.channel_id=p.channel_id and a.project_id=p.project_id
                    where p.id=? and c.state='active' and a.state='active'
                    and not exists (select 1 from resource_lifecycles l where l.state<>'active'
                        and ((l.kind='project' and l.resource_id=p.project_id) or (l.kind='workspace' and l.resource_id=c.workspace_id)))`)
                    .get(input.publicationId)
                if (!usable)
                    throw new DomainInvariantError(
                        'invalid_transition',
                        'The channel is unavailable for new effects'
                    )
                const rules = get(row.channelId)!
                client
                    .query(`insert into publication_cadence_overrides (publication_id,rules_revision,scheduled_at,actor_id,created_at)
                values (?,?,?,?,?) on conflict(publication_id) do update set rules_revision=excluded.rules_revision,scheduled_at=excluded.scheduled_at,actor_id=excluded.actor_id,created_at=excluded.created_at`)
                    .run(
                        input.publicationId,
                        rules.revision,
                        current.scheduledAt,
                        input.actorId,
                        input.now
                    )
                client
                    .query(`insert into audit_events (id,project_id,actor_id,action,entity_type,entity_id,metadata_json,created_at)
                values (?,?,?,'publication.cadence_spacing_overridden','publication',?,?,?)`)
                    .run(
                        crypto.randomUUID(),
                        input.projectId,
                        input.actorId,
                        input.publicationId,
                        JSON.stringify({
                            rule: 'minimum_interval',
                            rulesRevision: rules.revision,
                            scheduledAt: current.scheduledAt,
                            eligibleAt: current.eligibleAt,
                        }),
                        input.now
                    )
                recordDatabaseCommitProject(database, input.projectId)
                return timing(input.projectId, input.publicationId)
            }
        ),
        /** Called only inside the planning writer's immediate transaction. */
        check(input: {
            projectId: string
            actorId: string
            now: number
            confirmation?: string
            candidates: readonly {
                id: string
                channelId: string
                at: number | null
                actualId?: string
                immediate?: boolean
            }[]
        }) {
            for (const candidate of input.candidates)
                client
                    .query('delete from publication_cadence_overrides where publication_id=?')
                    .run(candidate.id)
            const warnings: CadenceWarning[] = []
            const snapshots: unknown[] = []
            for (const channelId of [...new Set(input.candidates.map(p => p.channelId))].sort()) {
                if (!input.candidates.some(c => c.channelId === channelId && c.at !== null))
                    continue
                const rules = get(channelId)
                if (!rules || (rules.dailyMax === null && rules.weeklyMax === null)) continue
                const existing = client
                    .query<
                        { id: string; at: number; state: string; updatedAt: number },
                        [string, number, number]
                    >(`
                    select p.id, coalesce(p.published_at,p.scheduled_at,p.updated_at) as at,p.state,p.updated_at as updatedAt, (select max(e.sequence) from audit_events e where e.entity_id=p.id and e.project_id=p.project_id) as journalRevision
                    from publications p where p.channel_id=?
                    and p.state in ('scheduled','ready','publishing','published','ambiguous')
                    and coalesce(p.published_at,p.scheduled_at,p.updated_at) between ?2 and ?3
                    and (p.state in ('published','ambiguous') or exists (
                        select 1 from project_channel_attachments a where a.channel_id=p.channel_id
                        and a.project_id=p.project_id and a.state='active'
                    )) order by p.id
                `)
                    .all(
                        channelId,
                        Math.min(
                            ...input.candidates
                                .filter(c => c.channelId === channelId && c.at !== null)
                                .map(c => c.at!)
                        ) -
                            8 * 86400000,
                        Math.max(
                            ...input.candidates
                                .filter(c => c.channelId === channelId && c.at !== null)
                                .map(c => c.at!)
                        ) +
                            8 * 86400000
                    )
                    .filter(p => !input.candidates.some(c => c.id === p.id))
                const candidates = input.candidates.filter(
                    p => p.channelId === channelId && p.at !== null
                )
                const all = [...existing, ...candidates.map(p => ({ ...p, at: p.at! }))]
                snapshots.push({ rules, existing })
                for (const rule of ['daily_max', 'weekly_max'] as const) {
                    const maximum = rule === 'daily_max' ? rules.dailyMax : rules.weeklyMax
                    if (maximum === null) continue
                    const key = rule === 'daily_max' ? 'day' : 'week'
                    const periods = new Set(
                        candidates.map(p => cadencePeriod(p.at!, rules.timeZone)[key])
                    )
                    for (const period of [...periods].sort()) {
                        const count = all.filter(
                            p => cadencePeriod(p.at, rules.timeZone)[key] === period
                        ).length
                        if (count > maximum)
                            warnings.push({ channelId, rule, period, maximum, count })
                    }
                }
            }
            if (!warnings.length) return
            const confirmation = cadenceFingerprint({
                projectId: input.projectId,
                candidates: input.candidates.map(({ actualId: _actualId, ...candidate }) =>
                    candidate.immediate
                        ? {
                              ...candidate,
                              at: cadencePeriod(candidate.at!, get(candidate.channelId)!.timeZone),
                          }
                        : candidate
                ),
                publicationRevisions: input.candidates.map(candidate =>
                    client
                        .query(`select p.id,p.state,p.scheduled_at,p.updated_at,p.target_revision_id,
                    (select max(e.sequence) from audit_events e where e.entity_id=p.id and e.project_id=p.project_id) as journalRevision
                    from publications p where p.project_id=? and p.id=?`)
                        .get(input.projectId, candidate.id)
                ),
                snapshots,
                warnings,
            })
            if (confirmation !== input.confirmation)
                throw new CadenceConflictError(confirmation, warnings)
            client
                .query(`insert into audit_events (id,project_id,actor_id,action,entity_type,entity_id,metadata_json,created_at)
                values (?,?,?,'publication.cadence_confirmed','channel',?,?,?)`)
                .run(
                    crypto.randomUUID(),
                    input.projectId,
                    input.actorId,
                    warnings[0]!.channelId,
                    JSON.stringify({
                        confirmation,
                        warnings,
                        candidates: input.candidates.map(c => ({ ...c, id: c.actualId ?? c.id })),
                    }),
                    input.now
                )
        },
        eligibleAt(publicationId: string, runAt: number): number {
            return (
                client
                    .query<{ at: number }, [number, string]>(`
                select ${cadenceEligibleAtSql} as at from (select ?1 as run_at) jobs
                join publications on publications.id=?2
            `)
                    .get(runAt, publicationId)?.at ?? runAt
            )
        },
        recordEffect(publicationId: string, now: number) {
            client
                .query(
                    `update channel_cadence set last_effect_at=? where channel_id=(select channel_id from publications where id=?)`
                )
                .run(now, publicationId)
            // A spacing override admits one effect, never every retry of that publication.
            client
                .query('delete from publication_cadence_overrides where publication_id=?')
                .run(publicationId)
        },
    }
}

export function validateCadence(input: Omit<ChannelCadence, 'channelId' | 'revision'>) {
    try {
        new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).format(0)
    } catch {
        throw new DomainInvariantError('invalid_input', 'Invalid channel timezone')
    }
    for (const value of [input.dailyMax, input.weeklyMax, input.minimumIntervalMs]) {
        if (value !== null && (!Number.isSafeInteger(value) || value <= 0))
            throw new DomainInvariantError(
                'invalid_input',
                'Cadence values must be positive safe integers or null'
            )
    }
}
