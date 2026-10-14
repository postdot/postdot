'use client'

import { Button } from '@postbot/ui/components/button'
import Link from 'next/link'

import { PostbotLogo } from './brand'
import { PublicThemeToggle } from './public-theme-toggle'
import { PublicWordmark } from './public-wordmark'

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
            <header className="home-error-header">
                <Link href="/" className="home-brand" aria-label="Postbot home">
                    <PostbotLogo className="home-logo" />
                    <PublicWordmark />
                </Link>
                <PublicThemeToggle />
            </header>
            <main className="home-error-main">
                <span className="home-error-number" aria-hidden="true">
                    {notFound ? '404' : 'Oops.'}
                </span>
                <h1>{notFound ? "This page isn't here." : "This page couldn't load."}</h1>
                <p>
                    {notFound
                        ? 'The link may have changed. You can start again from the homepage.'
                        : 'Try again, or return to the homepage.'}
                </p>
                <div className="home-actions">
                    {retry && (
                        <Button className="home-action" onClick={retry}>
                            Try again
                        </Button>
                    )}
                    <Button nativeButton={false} className="home-action" render={<Link href="/" />}>
                        Back home
                    </Button>
                </div>
            </main>
        </div>
    )
}
