import type { ReactNode } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'

/** Header for settings and project administration pages; these are navigation destinations and carry no return. */
export function AccessPageHeader({
    title,
    action,
    column,
    description,
}: {
    readonly title: string
    readonly action?: ReactNode
    readonly column?: 'management' | 'reading'
    readonly description?: string
}) {
    return (
        <DashboardPageHeader
            action={action}
            column={column}
            description={description}
            title={title}
        />
    )
}
