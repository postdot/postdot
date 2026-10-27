export interface CadenceWarning {
    channelId: string
    rule: 'daily_max' | 'weekly_max'
    period: string
    maximum: number
    count: number
}
export interface CadencePrompt {
    warnings: readonly CadenceWarning[]
    resolve: (confirmed: boolean) => void
}
let current: CadencePrompt | null = null
const listeners = new Set<() => void>()
export const cadencePrompts = {
    subscribe(listener: () => void) {
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
        }
    },
    getSnapshot: () => current,
}
function ask(warnings: readonly CadenceWarning[]) {
    return new Promise<boolean>(resolve => {
        // A second operation cannot confirm a different operation's conflict.
        current?.resolve(false)
        current = {
            warnings,
            resolve: answer => {
                current = null
                for (const listener of listeners) listener()
                resolve(answer)
            },
        }
        for (const listener of listeners) listener()
    })
}
export async function withCadenceConfirmation<T>(
    operation: (confirmation?: string) => Promise<T>
): Promise<T> {
    let confirmation: string | undefined
    for (;;) {
        try {
            return await operation(confirmation)
        } catch (error) {
            const conflict = error as {
                code?: string
                confirmation?: string
                warnings?: readonly CadenceWarning[]
            }
            if (
                conflict.code !== 'cadence_conflict' ||
                !conflict.confirmation ||
                !(await ask(conflict.warnings ?? []))
            )
                throw error
            confirmation = conflict.confirmation
        }
    }
}
