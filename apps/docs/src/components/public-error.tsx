'use client'

import { Button } from '@postbot/ui/components/button'
import { motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'

import { PostbotLogo } from './brand'
import { PublicFooter } from './public-footer'
import { PublicHeader } from './public-header'

import './public-home.css'

export function PublicError({
    notFound = false,
    retry,
}: {
    notFound?: boolean
    retry?: () => void
}) {
    const reduced = useReducedMotion()
    return (
        <div className="public-home home-error-page">
            <PublicHeader />
            <main className="home-error-main">
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
                <div className="home-error-art" aria-hidden="true">
                    <svg viewBox="0 0 480 400" className="home-error-route">
                        <path
                            className="home-error-route-track"
                            d="M-30 320H90Q120 320 120 290V120Q120 90 150 90H290Q320 90 320 120V162"
                        />
                        <motion.path
                            d="M-30 320H90Q120 320 120 290V120Q120 90 150 90H290Q320 90 320 120V162"
                            initial={false}
                            style={{ pathLength: reduced ? 1 : 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: reduced ? 0 : 0.9, ease: 'easeOut' }}
                        />
                        <circle cx="320" cy="162" r="7" />
                    </svg>
                    <div className="home-error-destination">
                        <div className="home-error-status">
                            <PostbotLogo className="home-error-mascot" />
                            <span>{notFound ? '404' : 'Oops.'}</span>
                        </div>
                        <small>{notFound ? 'Destination not found' : 'Page unavailable'}</small>
                    </div>
                </div>
            </main>
            <PublicFooter />
        </div>
    )
}
