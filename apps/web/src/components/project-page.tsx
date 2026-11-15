import type { ReactNode } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { PageColumn } from '@/components/page-column'

export function ProjectPage({
    title,
    action,
    headerChildren,
    width,
    children,
}: {
    readonly title: string
    readonly action?: ReactNode
    readonly headerChildren?: ReactNode
    readonly width: 'full' | 'reading' | 'wide'
    readonly children: ReactNode
}) {
    const column = width === 'wide' ? 'management' : width === 'reading' ? 'reading' : undefined
    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <DashboardPageHeader action={action} column={column} title={title}>
                {headerChildren}
            </DashboardPageHeader>
            {column ? <PageColumn variant={column}>{children}</PageColumn> : children}
        </main>
    )
}
