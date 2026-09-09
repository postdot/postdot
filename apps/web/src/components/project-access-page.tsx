import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@herald/ui/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { AddIcon } from '@solar-icons/react/bold/add'
import { CopyIcon } from '@solar-icons/react/bold/copy'
import { KeyMinimalisticIcon } from '@solar-icons/react/bold/key-minimalistic'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'
import { useEffect, useState, type FormEvent } from 'react'

import { ProjectAccessTokenList } from '@/components/project-access-token-list'
import { api, formatApiError, type ProjectAccessToken } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function ProjectAccessPage() {
    useLanguage()
    const { project } = useProjectDashboard()
    const [tokens, setTokens] = useState<ProjectAccessToken[] | null>(null)
    const [name, setName] = useState('')
    const [createdToken, setCreatedToken] = useState<{ name: string; token: string } | null>(null)
    const [tokenToRevoke, setTokenToRevoke] = useState<ProjectAccessToken | null>(null)
    const [copied, setCopied] = useState(false)
    const [copyError, setCopyError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setTokens(null)
        setError(null)

        void api
            .listProjectAccessTokens(project.id)
            .then(response => {
                if (!cancelled) setTokens(response.accessTokens)
            })
            .catch(caughtError => {
                if (!cancelled) setError(errorMessage(caughtError))
            })

        return () => {
            cancelled = true
        }
    }, [project.id])

    async function handleCreate(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const normalizedName = name.trim()
        if (normalizedName === '') return

        await runAction(async () => {
            const response = await api.createProjectAccessToken(project.id, normalizedName)
            setCreatedToken({ name: response.accessToken.name, token: response.token })
            setCopied(false)
            setCopyError(null)
            setName('')
            setTokens(current => (current === null ? current : [response.accessToken, ...current]))
        })
    }

    async function handleRevoke() {
        if (tokenToRevoke === null) return
        const tokenId = tokenToRevoke.id

        await runAction(async () => {
            const response = await api.revokeProjectAccessToken(project.id, tokenId)
            setTokens(
                current =>
                    current?.map(token => (token.id === tokenId ? response.accessToken : token)) ??
                    null
            )
            setTokenToRevoke(null)
        })
    }

    async function handleCopy() {
        if (createdToken === null) return

        setCopyError(null)
        try {
            await navigator.clipboard.writeText(createdToken.token)
            setCopied(true)
        } catch {
            setCopyError(m.access_copy_unavailable())
        }
    }

    async function runAction(action: () => Promise<void>) {
        setError(null)
        setPending(true)
        try {
            await action()
        } catch (caughtError) {
            setError(errorMessage(caughtError))
        } finally {
            setPending(false)
        }
    }

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <div className="mx-auto max-w-5xl">
                <div className="flex items-start gap-3">
                    <KeyMinimalisticIcon
                        className="mt-1 size-5 shrink-0 text-primary"
                        aria-hidden="true"
                    />
                    <div className="min-w-0">
                        <h1 className="font-heading text-3xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-4xl">
                            {m.access_title()}
                        </h1>
                        <details className="group mt-2 max-w-2xl text-sm leading-6">
                            <summary className="cursor-pointer font-medium text-foreground marker:text-muted-foreground">
                                {m.access_summary()}
                            </summary>
                            <p className="mt-2 text-muted-foreground">
                                {m.access_page_description()}
                            </p>
                        </details>
                    </div>
                </div>

                {error ? (
                    <Alert className="mt-6" variant="destructive">
                        <AlertTitle>{m.access_action_failed()}</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}

                {createdToken ? (
                    <section
                        aria-labelledby="new-token-title"
                        className="mt-6 bg-primary/10 p-5 shadow-surface sm:p-6">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h2
                                    id="new-token-title"
                                    className="font-heading text-base font-medium">
                                    {m.access_token_created_for({ name: createdToken.name })}
                                </h2>
                                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                                    {m.access_token_show_once()}
                                </p>
                            </div>
                            <Badge variant="default">{m.access_token_shown_once()}</Badge>
                        </div>
                        <code className="mt-4 block overflow-x-auto bg-background px-3 py-3 text-xs leading-5 text-foreground shadow-field">
                            {createdToken.token}
                        </code>
                        {copyError ? (
                            <p className="mt-2 text-sm text-state-failed" role="alert">
                                {copyError}
                            </p>
                        ) : null}
                        <div className="mt-4 flex flex-wrap gap-2">
                            <Button type="button" size="sm" onClick={() => void handleCopy()}>
                                <CopyIcon aria-hidden="true" />
                                {copied ? m.access_token_copied() : m.access_token_copy()}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setCreatedToken(null)}>
                                {m.access_token_done()}
                            </Button>
                        </div>
                    </section>
                ) : null}

                <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
                    <section className="bg-surface-raised p-5 shadow-surface sm:p-6">
                        <h2 className="font-heading text-base font-medium">
                            {m.access_create_section()}
                        </h2>
                        <p className="mt-1 text-sm leading-5 text-muted-foreground">
                            {m.access_create_section_description()}
                        </p>
                        <form className="mt-5 grid gap-4" onSubmit={handleCreate}>
                            <Field className="gap-1.5">
                                <FieldLabel htmlFor="project-access-token-name">
                                    {m.access_token_name()}
                                </FieldLabel>
                                <Input
                                    id="project-access-token-name"
                                    maxLength={100}
                                    required
                                    value={name}
                                    onChange={event => setName(event.target.value)}
                                    placeholder={m.access_token_name_placeholder()}
                                />
                                <FieldDescription>{m.access_token_name_help()}</FieldDescription>
                            </Field>
                            <Button type="submit" disabled={pending}>
                                <AddIcon aria-hidden="true" />
                                {m.access_create_button()}
                            </Button>
                        </form>
                    </section>

                    <ProjectAccessTokenList
                        onRevoke={setTokenToRevoke}
                        pending={pending}
                        tokens={tokens}
                    />
                </div>
            </div>

            <Dialog
                open={tokenToRevoke !== null}
                onOpenChange={open => {
                    if (!open && !pending) setTokenToRevoke(null)
                }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{m.access_revoke_title()}</DialogTitle>
                        <DialogDescription>
                            {tokenToRevoke
                                ? m.access_revoke_detail({ token: tokenToRevoke.name })
                                : null}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <DialogClose render={<Button variant="ghost" disabled={pending} />}>
                            {m.common_cancel()}
                        </DialogClose>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={pending}
                            onClick={() => void handleRevoke()}>
                            <TrashBinMinimalisticIcon aria-hidden="true" />
                            {m.access_revoke_button()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    )
}

function errorMessage(error: unknown) {
    return formatApiError(error)
}
