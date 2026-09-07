import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { KeyMinimalisticIcon } from '@solar-icons/react/bold/key-minimalistic'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'

import type { ProjectAccessToken } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface ProjectAccessTokenListProps {
    readonly onRevoke: (token: ProjectAccessToken) => void
    readonly pending: boolean
    readonly tokens: readonly ProjectAccessToken[] | null
}

export function ProjectAccessTokenList({ onRevoke, pending, tokens }: ProjectAccessTokenListProps) {
    return (
        <section aria-labelledby="active-tokens-title" className="min-w-0">
            <div className="flex items-baseline justify-between gap-4">
                <div>
                    <h2 id="active-tokens-title" className="font-heading text-base font-medium">
                        {m.access_tokens()}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {m.access_token_list_metadata()}
                    </p>
                </div>
                {tokens ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                        {m.common_token_count({ count: tokens.length })}
                    </span>
                ) : null}
            </div>

            {tokens === null ? (
                <p className="mt-5 text-sm text-muted-foreground" role="status">
                    {m.access_loading()}
                </p>
            ) : tokens.length === 0 ? (
                <Empty className="mt-5 min-h-48 bg-muted px-5 py-8">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <KeyMinimalisticIcon aria-hidden="true" />
                        </EmptyMedia>
                        <EmptyTitle>{m.access_empty_title()}</EmptyTitle>
                        <EmptyDescription>{m.access_empty_workflow()}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <ul className="mt-5 grid gap-2" aria-label={m.access_token_list_label()}>
                    {tokens.map(token => (
                        <TokenRow
                            key={token.id}
                            pending={pending}
                            token={token}
                            onRevoke={() => onRevoke(token)}
                        />
                    ))}
                </ul>
            )}
        </section>
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
    const { locale } = useLanguage()
    const revoked = token.revokedAt !== null
    return (
        <li className="flex min-w-0 flex-col gap-3 bg-surface-raised px-4 py-3 shadow-surface sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{token.name}</span>
                    <Badge variant={revoked ? 'outline' : 'default'}>
                        {revoked ? m.access_revoked() : m.access_active()}
                    </Badge>
                </div>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {token.tokenPrefix} ·{' '}
                    {token.expiresAt === null
                        ? m.common_never_expires()
                        : m.common_expires_on({
                              date: formatDateTime(token.expiresAt, 'UTC', locale),
                          })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                    {m.common_created_on({ date: formatDateTime(token.createdAt, 'UTC', locale) })}
                </p>
            </div>
            <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending || revoked}
                onClick={onRevoke}>
                <TrashBinMinimalisticIcon aria-hidden="true" />
                {revoked ? m.access_revoked() : m.access_revoke()}
            </Button>
        </li>
    )
}
