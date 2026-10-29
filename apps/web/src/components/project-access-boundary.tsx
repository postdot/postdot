import { Button, buttonVariants } from '@postdot/ui/components/button'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { EmptyState } from '@/components/empty-state'
import { useLanguage } from '@/lib/i18n'
import type { ProjectAccess } from '@/lib/project-access'
import * as m from '@/paraglide/messages.js'

/** Retain mounted local forms during a technical check; remove them only on confirmed denial. */
export function ProjectAccessBoundary({
    access,
    children,
    editorOwnsAccess,
}: {
    readonly access: ProjectAccess
    readonly children: ReactNode
    readonly editorOwnsAccess: boolean
}) {
    useLanguage()
    if (editorOwnsAccess) return children
    if (access.status === 'denied')
        return (
            <main className="w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
                <EmptyState
                    action={
                        <Link
                            className={buttonVariants({ variant: 'default' })}
                            to="/dashboard"
                            search={{ projectId: 'none' }}>
                            {m.nav_select_project()}
                        </Link>
                    }
                    description={m.dashboard_select_project_description()}
                    illustration="access"
                    title={m.editor_access_denied_title()}
                />
            </main>
        )
    const blocked = access.status !== 'confirmed'
    return (
        <>
            {blocked ? (
                <main className="w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
                    {access.status === 'technical-error' ? (
                        <EmptyState
                            action={
                                <Button
                                    onClick={() => void access.verify()}
                                    size="sm"
                                    variant="ghost">
                                    {m.common_retry()}
                                </Button>
                            }
                            layout="compact"
                            title={m.project_access_unconfirmed_title()}
                            description={m.project_access_unconfirmed_description()}
                        />
                    ) : (
                        <p role="status" className="text-sm text-muted-foreground">
                            {m.editor_access_checking()}
                        </p>
                    )}
                </main>
            ) : null}
            <div className={blocked ? 'hidden' : 'contents'} hidden={blocked} inert={blocked}>
                {children}
            </div>
        </>
    )
}
