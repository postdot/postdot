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
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { Field, FieldDescription, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { AddIcon } from '@solar-icons/react/bold/add'
import { CopyIcon } from '@solar-icons/react/bold/copy'
import { KeyMinimalisticIcon } from '@solar-icons/react/bold/key-minimalistic'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'
import { useEffect, useState, type FormEvent } from 'react'

import { ApiError, api, type ProjectAccessToken } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'

export function ProjectAccessPage() {
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
            setCopyError('Copying was unavailable. Copy the token manually.')
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
                            Project access
                        </h1>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                            Create project-scoped tokens for scripts, agents, and CI. A token can
                            use project operations, but it cannot manage access or start publisher
                            OAuth.
                        </p>
                    </div>
                </div>

                {error ? (
                    <Alert className="mt-6" variant="destructive">
                        <AlertTitle>Access action failed</AlertTitle>
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
                                    Token created for {createdToken.name}
                                </h2>
                                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                                    This is the only time Herald will show the full token. Store it
                                    in your secret manager before dismissing this message.
                                </p>
                            </div>
                            <Badge variant="default">Shown once</Badge>
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
                                {copied ? 'Copied' : 'Copy token'}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setCreatedToken(null)}>
                                Done
                            </Button>
                        </div>
                    </section>
                ) : null}

                <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
                    <section className="bg-surface-raised p-5 shadow-surface sm:p-6">
                        <h2 className="font-heading text-base font-medium">Create a token</h2>
                        <p className="mt-1 text-sm leading-5 text-muted-foreground">
                            Name the machine or workflow that will use this project boundary.
                        </p>
                        <form className="mt-5 grid gap-4" onSubmit={handleCreate}>
                            <Field className="gap-1.5">
                                <FieldLabel htmlFor="project-access-token-name">Name</FieldLabel>
                                <Input
                                    id="project-access-token-name"
                                    maxLength={100}
                                    required
                                    value={name}
                                    onChange={event => setName(event.target.value)}
                                    placeholder="Release automation"
                                />
                                <FieldDescription>
                                    Use a name that will still be meaningful when this token needs
                                    to be revoked.
                                </FieldDescription>
                            </Field>
                            <Button type="submit" disabled={pending}>
                                <AddIcon aria-hidden="true" />
                                Create token
                            </Button>
                        </form>
                    </section>

                    <section aria-labelledby="active-tokens-title" className="min-w-0">
                        <div className="flex items-baseline justify-between gap-4">
                            <div>
                                <h2
                                    id="active-tokens-title"
                                    className="font-heading text-base font-medium">
                                    Project tokens
                                </h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Only metadata and the non-secret prefix are retained here.
                                </p>
                            </div>
                            {tokens ? (
                                <span className="text-xs tabular-nums text-muted-foreground">
                                    {tokens.length} {tokens.length === 1 ? 'token' : 'tokens'}
                                </span>
                            ) : null}
                        </div>

                        {tokens === null ? (
                            <p className="mt-5 text-sm text-muted-foreground" role="status">
                                Loading project tokens…
                            </p>
                        ) : tokens.length === 0 ? (
                            <Empty className="mt-5 min-h-48 bg-muted px-5 py-8">
                                <EmptyHeader>
                                    <EmptyMedia variant="icon">
                                        <KeyMinimalisticIcon aria-hidden="true" />
                                    </EmptyMedia>
                                    <EmptyTitle>No project tokens</EmptyTitle>
                                    <EmptyDescription>
                                        Create one when a script, agent, or CI workflow needs
                                        access.
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        ) : (
                            <ul className="mt-5 grid gap-2" aria-label="Project access tokens">
                                {tokens.map(token => (
                                    <TokenRow
                                        key={token.id}
                                        pending={pending}
                                        token={token}
                                        onRevoke={() => setTokenToRevoke(token)}
                                    />
                                ))}
                            </ul>
                        )}
                    </section>
                </div>
            </div>

            <Dialog
                open={tokenToRevoke !== null}
                onOpenChange={open => {
                    if (!open && !pending) setTokenToRevoke(null)
                }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Revoke this token?</DialogTitle>
                        <DialogDescription>
                            {tokenToRevoke
                                ? `“${tokenToRevoke.name}” will stop authenticating immediately. Existing audit history is preserved.`
                                : null}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <DialogClose render={<Button variant="ghost" disabled={pending} />}>
                            Cancel
                        </DialogClose>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={pending}
                            onClick={() => void handleRevoke()}>
                            <TrashBinMinimalisticIcon aria-hidden="true" />
                            Revoke token
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    )
}

function TokenRow({
    onRevoke,
    pending,
    token,
}: {
    readonly onRevoke: () => void
    readonly pending: boolean
    readonly token: ProjectAccessToken
}) {
    const revoked = token.revokedAt !== null
    return (
        <li className="flex min-w-0 flex-col gap-3 bg-surface-raised px-4 py-3 shadow-surface sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{token.name}</span>
                    <Badge variant={revoked ? 'outline' : 'default'}>
                        {revoked ? 'Revoked' : 'Active'}
                    </Badge>
                </div>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {token.tokenPrefix} ·{' '}
                    {token.expiresAt === null
                        ? 'Never expires'
                        : `Expires ${formatDate(token.expiresAt)}`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                    Created {formatDate(token.createdAt)}
                </p>
            </div>
            <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending || revoked}
                onClick={onRevoke}>
                <TrashBinMinimalisticIcon aria-hidden="true" />
                {revoked ? 'Revoked' : 'Revoke'}
            </Button>
        </li>
    )
}

function formatDate(timestamp: number) {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(timestamp))
}

function errorMessage(error: unknown) {
    return error instanceof ApiError ? error.message : 'The action could not be completed'
}
