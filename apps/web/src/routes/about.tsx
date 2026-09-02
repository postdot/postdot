import { ArrowLeftIcon } from '@solar-icons/react/bold/arrow-left'
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/about')({
    component: AboutPage,
})

function AboutPage() {
    return (
        <section className="max-w-3xl py-24 sm:py-32">
            <div className="rounded-xl border bg-card p-8 shadow-sm sm:p-10">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
                    Early workspace
                </p>
                <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">
                    Herald is being built deliberately small.
                </h1>
                <p className="mt-8 text-lg leading-8 text-muted-foreground">
                    The dashboard will coordinate projects, channels, posts, and publications while
                    keeping manual destinations first-class.
                </p>
                <Link
                    to="/"
                    className="mt-10 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                    <ArrowLeftIcon aria-hidden="true" />
                    Back home
                </Link>
            </div>
        </section>
    )
}
