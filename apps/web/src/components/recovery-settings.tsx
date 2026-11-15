import { Button } from '@postdot/ui/components/button'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import {
    SettingsSection,
    SettingsCard,
    SettingsRow,
    SettingsLinkRow,
} from '@/components/settings-layout'
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
        <SettingsSection
            id="recovery-title"
            title={m.recovery_title()}
            description={m.recovery_description()}>
            <SettingsCard>
                <SettingsLinkRow href="/dashboard" title={m.recovery_review()} />
                <SettingsRow
                    title={m.recovery_confirmation()}
                    htmlFor="recovery-confirmation"
                    control={
                        <label className="flex items-start gap-3 text-sm">
                            <input
                                id="recovery-confirmation"
                                type="checkbox"
                                className="mt-1 size-4 accent-primary"
                                checked={confirmed}
                                onChange={event => setConfirmed(event.target.checked)}
                                disabled={pending}
                            />
                        </label>
                    }
                />
                {error && (
                    <p role="alert" className="mt-3 text-sm text-destructive">
                        {m.recovery_resume_failed()}
                    </p>
                )}
                <SettingsRow
                    title={m.recovery_resume()}
                    control={
                        <Button disabled={!confirmed || pending} onClick={() => void resume()}>
                            {pending ? m.common_loading() : m.recovery_resume()}
                        </Button>
                    }
                />
            </SettingsCard>
        </SettingsSection>
    )
}
