import { Button } from '@postbot/ui/components/button'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { api } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function RecoveryNotice() {
    const state = useQuery({ queryKey: ['recovery-status'], queryFn: api.getRecoveryStatus })
    if (!state.data?.held) return null
    return (
        <div role="status" className="border-b border-border bg-muted px-6 py-3 text-sm">
            {m.recovery_notice()}{' '}
            <Link to="/dashboard/settings" className="underline">
                {m.recovery_settings_link()}
            </Link>
        </div>
    )
}

export function RecoverySettings() {
    const client = useQueryClient()
    const state = useQuery({ queryKey: ['recovery-state'], queryFn: api.getRecoveryState })
    const [confirmed, setConfirmed] = useState(false)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState(false)
    async function resume() {
        const token = state.data?.hold?.token
        if (!token || !confirmed || pending) return
        setPending(true)
        setError(false)
        try {
            const result = await api.resumeAfterRestore(token)
            client.setQueryData(['recovery-state'], result)
            client.setQueryData(['recovery-status'], { held: result.held })
            await client.invalidateQueries({ queryKey: ['project'] })
        } catch {
            setError(true)
        } finally {
            setPending(false)
        }
    }
    if (state.isPending) return <p className="mt-8 text-sm">{m.common_loading()}</p>
    if (state.isError)
        return (
            <div className="mt-8">
                <p role="alert">{m.recovery_load_failed()}</p>
                <Button variant="outline" onClick={() => void state.refetch()}>
                    {m.common_retry()}
                </Button>
            </div>
        )
    if (!state.data.held) return null
    return (
        <section
            className="mx-auto mt-10 w-full max-w-3xl border-t border-border/50 pt-8"
            aria-labelledby="recovery-title">
            <h2 id="recovery-title" className="font-heading text-xl font-semibold">
                {m.recovery_title()}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{m.recovery_description()}</p>
            <Link to="/dashboard" className="mt-4 inline-block text-sm underline">
                {m.recovery_review()}
            </Link>
            <label className="mt-5 flex items-start gap-3 text-sm">
                <input
                    type="checkbox"
                    className="mt-1 size-4 accent-primary"
                    checked={confirmed}
                    onChange={event => setConfirmed(event.target.checked)}
                    disabled={pending}
                />
                <span>{m.recovery_confirmation()}</span>
            </label>
            {error && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                    {m.recovery_resume_failed()}
                </p>
            )}
            <Button className="mt-4" disabled={!confirmed || pending} onClick={() => void resume()}>
                {pending ? m.common_loading() : m.recovery_resume()}
            </Button>
        </section>
    )
}
