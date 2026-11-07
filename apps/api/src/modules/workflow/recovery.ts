import { isPostgresTransactionConflict } from '@postdot/db'

/** Retry scheduling from durable state, never replay a provider call directly. */
export function workflowRecoveryDelay(
    dialect: string,
    error: unknown,
    failures: number
): number | null {
    if (dialect !== 'postgres' || !isPostgresTransactionConflict(error)) return null
    return Math.min(30_000, 1_000 * 2 ** Math.min(failures - 1, 5))
}
