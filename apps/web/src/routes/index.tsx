import { Button } from '@herald/ui/components/button'
import { ArrowRightIcon } from '@solar-icons/react/bold/arrow-right'
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
    component: HomePage,
})

function HomePage() {
    return (
        <section className="max-w-3xl py-24 sm:py-32">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
                Publication orchestration
            </p>
            <h1 className="mt-6 text-5xl font-semibold tracking-tight text-balance sm:text-7xl">
                One source of truth for every destination.
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-muted-foreground">
                Herald brings automated and manual publications into the same workflow.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
                <Button size="lg">
                    Explore the workspace
                    <ArrowRightIcon aria-hidden="true" />
                </Button>
                <Link
                    to="/about"
                    className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                    Read the context
                </Link>
            </div>
        </section>
    )
}
