'use client'

import { Button } from '@postbot/ui/components/button'
import Link from 'next/link'

import { PublicFooter } from './public-footer'
import { PublicHeader } from './public-header'
import { PublicMaterial } from './public-material'

import './public-home.css'

export function PublicError({
    notFound = false,
    retry,
}: {
    notFound?: boolean
    retry?: () => void
}) {
    return (
        <div className="public-home home-error-page">
            <PublicHeader />
            <main className="home-error-main">
                <PublicMaterial />
                <div className="home-error-code" aria-hidden="true">
                    <span>{notFound ? '404' : 'Oops.'}</span>
                </div>
                <div className="home-error-copy">
                    <h1>{notFound ? "This page isn't here." : "This page couldn't load."}</h1>
                    <p>
                        {notFound
                            ? 'The address may have changed. Head home, or find what you need in the documentation.'
                            : 'Try loading this page again. You can also head home or open the documentation.'}
                    </p>
                    <div className="home-actions">
                        {retry && (
                            <Button className="home-action" onClick={retry}>
                                Try again
                            </Button>
                        )}
                        <Button
                            nativeButton={false}
                            className={`home-action ${retry ? 'home-action-secondary' : ''}`}
                            variant={retry ? 'outline' : 'default'}
                            render={<Link href="/" />}>
                            Back home
                        </Button>
                    </div>
                    <Link className="home-error-docs" href="/docs/">
                        Open the documentation
                    </Link>
                </div>
            </main>
            <PublicFooter />
        </div>
    )
}
