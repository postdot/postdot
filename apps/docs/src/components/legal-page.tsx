import type { ReactNode } from 'react'

import { PublicFooter } from './public-footer'
import { PublicHeader } from './public-header'

import './legal-page.css'
import './public-home.css'

export function LegalPage({
    title,
    updated,
    children,
}: {
    title: string
    updated: string
    children: ReactNode
}) {
    return (
        <div className="public-home">
            <PublicHeader />
            <main id="main-content" tabIndex={-1} className="legal-main">
                <h1>{title}</h1>
                <p className="legal-updated">Last updated {updated}</p>
                {children}
            </main>
            <PublicFooter />
        </div>
    )
}
