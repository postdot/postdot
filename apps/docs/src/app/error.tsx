'use client'

import { PublicError } from '@/components/public-error'

export default function ErrorPage({ reset }: { reset: () => void }) {
    return <PublicError retry={reset} />
}
