import { requireNonBlank, type ChannelProfileDefinition } from '@postdot/core'

import type { ChannelDestinationIdentity } from './channel-destination'
import { defineTransaction, type DatabaseHandle } from './client'

export interface ThreadReceiptValidationInput {
    readonly profile: ChannelProfileDefinition
    readonly destination: ChannelDestinationIdentity | null
    readonly receipt: ThreadReceipt
}

export interface ThreadReceipt {
    readonly externalId: string
    readonly externalUrl?: string
    readonly externalCid?: string
}

export interface PublicationThreadMessage {
    readonly executionRevisionId: string
    readonly position: number
    readonly state: 'pending' | 'sending' | 'confirmed' | 'failed' | 'ambiguous'
    readonly externalId: string | null
    readonly externalUrl: string | null
    readonly externalCid: string | null
    readonly errorMessage: string | null
}

export interface ThreadMessageIdentity {
    readonly projectId: string
    readonly executionRevisionId: string
    readonly position: number
}

const columns = `execution_revision_id as executionRevisionId, position, state,
    external_id as externalId, external_url as externalUrl, external_cid as externalCid,
    error_message as errorMessage`

export function createPublicationThreadStore(database: DatabaseHandle) {
    const sql = database.sql
    const load = sql.statement<PublicationThreadMessage, [string, string, number]>(`
        select ${columns} from publication_thread_messages
        where project_id = ? and execution_revision_id = ? and position = ?`)
    const reserve = defineTransaction(database, async (input: ThreadMessageIdentity) => {
        if (!Number.isSafeInteger(input.position) || input.position < 0 || input.position >= 25)
            throw new Error('Invalid thread message position')
        const args = [
            requireNonBlank(input.projectId, 'projectId'),
            requireNonBlank(input.executionRevisionId, 'executionRevisionId'),
            input.position,
        ] as const
        await sql
            .statement(`insert into publication_thread_messages(project_id,execution_revision_id,position)
            values (?,?,?) on conflict(project_id,execution_revision_id,position) do nothing`)
            .run(...args)
        return (await load.get(...args))!
    })
    return {
        reserve: (input: ThreadMessageIdentity) => reserve.immediate(input),
        async start(input: ThreadMessageIdentity): Promise<boolean> {
            return (
                (
                    await sql
                        .statement(`update publication_thread_messages set state = 'sending', error_message = null
                where project_id = ? and execution_revision_id = ? and position = ? and state in ('pending','failed')`)
                        .run(input.projectId, input.executionRevisionId, input.position)
                ).changes === 1
            )
        },
        async settle(
            input: ThreadMessageIdentity &
                (
                    | { readonly state: 'confirmed'; readonly receipt: ThreadReceipt }
                    | { readonly state: 'failed' | 'ambiguous'; readonly errorMessage: string }
                )
        ): Promise<boolean> {
            const receipt = input.state === 'confirmed' ? input.receipt : null
            return (
                (
                    await sql
                        .statement(`update publication_thread_messages set state = ?, external_id = ?,
                external_url = ?, external_cid = ?, error_message = ?
                where project_id = ? and execution_revision_id = ? and position = ? and state = 'sending'`)
                        .run(
                            input.state,
                            receipt ? requireNonBlank(receipt.externalId, 'externalId') : null,
                            receipt?.externalUrl ?? null,
                            receipt?.externalCid ?? null,
                            input.state === 'confirmed'
                                ? null
                                : requireNonBlank(input.errorMessage, 'errorMessage'),
                            input.projectId,
                            input.executionRevisionId,
                            input.position
                        )
                ).changes === 1
            )
        },
        async listPublication(
            projectId: string,
            publicationId: string
        ): Promise<PublicationThreadMessage[]> {
            return sql
                .statement<PublicationThreadMessage, [string, string]>(`
                select ${columns} from publication_thread_messages
                where project_id = ?1 and execution_revision_id = (
                    select e.id from publication_execution_revisions e
                    where e.project_id = ?1 and e.publication_id = ?2
                      and exists(select 1 from publication_thread_messages m where m.project_id = e.project_id and m.execution_revision_id = e.id)
                    order by e.created_at desc, e.id desc limit 1)
                order by position`)
                .all(projectId, publicationId)
        },
        /** Never begin a new execution after an earlier thread may have become public. */
        async hasPriorEffects(
            projectId: string,
            publicationId: string,
            executionRevisionId: string
        ): Promise<boolean> {
            return (
                (await sql
                    .statement<{ position: number }, [string, string, string]>(`
                select m.position from publication_thread_messages m
                join publication_execution_revisions e on e.project_id = m.project_id and e.id = m.execution_revision_id
                where e.project_id = ? and e.publication_id = ? and e.id <> ?
                  and m.state in ('sending','confirmed','ambiguous') limit 1`)
                    .get(projectId, publicationId, executionRevisionId)) !== null
            )
        },
    }
}

export type PublicationThreadPort = ReturnType<typeof createPublicationThreadStore>
